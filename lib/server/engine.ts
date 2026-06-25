import { randomUUID } from "node:crypto"
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb"
import { waitUntil } from "@vercel/functions"
import { computeCommissions, round2 } from "@/lib/commission"
import { insertSaleTxn, listPendingOutbox, markOutboxProcessed } from "./ledger"
import { addToVolume, getDistributor, putHealthRollup } from "./repository"
import { getNetworkHealth } from "./health"
import { docClient, keys, TABLE_NAME } from "./dynamo"
import { currentPeriod, type LedgerEntry, type Sale, type SaleType } from "@/lib/types"
import type { CommissionLine } from "@/lib/commission"

export interface RecordSaleInput {
  distributorId: string
  productId: string
  amount: number
  volume: number
  type: SaleType
  /** Client may supply for end-to-end idempotency; generated otherwise. */
  saleId?: string
}

export interface RecordSaleResult {
  sale: Sale
  commissions: LedgerEntry[]
}

export interface OutboxPayload {
  saleId: string
  sellerId: string
  sellerPath: string
  period: string
  volume: number
  saleType: SaleType
  beneficiaries: { id: string; amount: number }[]
}

/**
 * Pure function: builds the outbox payload from sale + commission data.
 * Contains everything needed to apply aggregates to DynamoDB without a DB read.
 */
export function buildOutboxPayload(
  sale: Sale,
  sellerPath: string,
  commissions: CommissionLine[],
  period: string,
): OutboxPayload {
  return {
    saleId: sale.saleId,
    sellerId: sale.distributorId,
    sellerPath,
    period,
    volume: sale.volume,
    saleType: sale.type,
    beneficiaries: commissions.map((c) => ({ id: c.beneficiaryId, amount: c.amount })),
  }
}

/**
 * Returns a DynamoDB TransactWriteItem Update element that atomically ADDs
 * each field using if_not_exists (mirrors addToVolume's expression building).
 */
export function volumeAddAction(
  id: string,
  period: string,
  fields: Record<string, number>,
): { Update: Record<string, unknown> } {
  const names: Record<string, string> = {}
  const values: Record<string, number | string> = { ":zero": 0 }
  const sets: string[] = []
  Object.entries(fields).forEach(([field, value], i) => {
    names[`#f${i}`] = field
    values[`:v${i}`] = round2(value)
    sets.push(`#f${i} = if_not_exists(#f${i}, :zero) + :v${i}`)
  })
  return {
    Update: {
      TableName: TABLE_NAME,
      Key: { PK: keys.dist(id), SK: keys.volume(period) },
      UpdateExpression: `SET ${sets.join(", ")}, #did = :did, #period = :period`,
      ExpressionAttributeNames: {
        ...names,
        "#did": "distributorId",
        "#period": "period",
      },
      ExpressionAttributeValues: { ...values, ":did": id, ":period": period },
    },
  }
}

/**
 * The commission engine (spec §4).
 * 1. Upline from the DynamoDB materialized path — zero traversal.
 * 2. ONE ACID DSQL transaction: sale + all ledger rows (deterministic txn_ids) + outbox row.
 * 3. Phase C: fire-and-forget drainOutbox() after commit (exactly-once via transactional outbox).
 * DSQL is the source of truth; DynamoDB aggregates are rebuildable from it.
 */
export async function recordSale(
  input: RecordSaleInput,
  at: Date = new Date(),
): Promise<RecordSaleResult> {
  const seller = await getDistributor(input.distributorId)
  if (!seller) throw new Error(`Unknown distributor: ${input.distributorId}`)

  const iso = at.toISOString()
  const period = currentPeriod(at)
  const sale: Sale = {
    saleId: input.saleId ?? randomUUID(),
    distributorId: seller.id,
    productId: input.productId,
    amount: round2(input.amount),
    volume: round2(input.volume),
    type: input.type,
    timestamp: iso,
  }
  const commissions = computeCommissions({
    saleId: sale.saleId,
    sellerPath: seller.path,
    volume: sale.volume,
  })

  // 2 — money + outbox row, atomically
  await insertSaleTxn({
    sale,
    sellerName: seller.name,
    commissions,
    period,
    outboxPayload: buildOutboxPayload(sale, seller.path, commissions, period),
  })

  // 3 — drain after commit (Phase C: exactly-once via transactional outbox).
  // On Vercel serverless the function instance freezes once the response is
  // sent, so a bare fire-and-forget would be cut off before the drain runs —
  // waitUntil keeps the instance alive until it completes. Outside a Vercel
  // request (local scripts / tests) waitUntil throws; the promise still runs to
  // completion because the Node process stays alive.
  const drain = drainOutbox().catch((e) => console.error("[drain]", e))
  try {
    waitUntil(drain)
  } catch {
    // not in a Vercel request context — let the promise run
  }

  return {
    sale,
    commissions: commissions.map((c) => ({
      txnId: c.txnId, beneficiaryId: c.beneficiaryId, sourceDistId: seller.id,
      sourceName: seller.name, level: c.level, amount: c.amount,
      period, timestamp: iso,
    })),
  }
}

/**
 * Propagate derived aggregates to DynamoDB.
 * Kept exported for reconcile/rebuild paths and tests.
 * No longer called by recordSale (replaced by the transactional outbox in Phase C).
 */
export async function propagateAggregates(
  sale: Sale,
  sellerPath: string,
  commissions: { beneficiaryId: string; amount: number }[],
  period: string,
): Promise<void> {
  const volumeField = sale.type === "retail" ? "retailVolume" : "starterVolume"
  const paid = new Map(commissions.map((c) => [c.beneficiaryId, c.amount]))
  const ancestors = sellerPath.split("/").slice(0, -1).reverse()
  // Phase B propagation is best-effort and NOT idempotent: the DynamoDB ADDs run
  // after the DSQL commit (the source of truth). If a call here fails or the
  // request is retried, aggregates can drift or double-count — they are always
  // rebuildable from the DSQL ledger (see scripts/reconcile.ts), and Phase C's
  // transactional outbox replaces this with exactly-once application.
  await Promise.all([
    addToVolume(sale.distributorId, period, {
      pv: sale.volume, gv: sale.volume, [volumeField]: sale.volume,
    }),
    ...ancestors.map((id) =>
      addToVolume(id, period, {
        gv: sale.volume,
        ...(paid.has(id) ? { commissionEarned: paid.get(id)! } : {}),
      }),
    ),
  ])
}

/**
 * Drains pending outbox events, applying each to DynamoDB exactly-once.
 * Returns the count of events processed (applied + marked).
 */
export async function drainOutbox(limit = 25): Promise<number> {
  const events = await listPendingOutbox(limit)
  let count = 0

  // Collect unique (rootId, period) pairs affected by this drain batch for health rollups.
  // Key format: `${rootId}|${period}` — deduped so each subtree is recomputed at most once.
  const affectedRootPeriods = new Set<string>()

  for (const event of events) {
    const payload = event.payload as OutboxPayload
    const { saleId, sellerId, sellerPath, period, volume, saleType, beneficiaries } = payload

    // Build a map of per-item field deltas to avoid duplicate items in TransactWriteItems
    // (DynamoDB forbids two actions on the SAME item in one transaction)
    const deltaMap = new Map<string, Record<string, number>>()

    const volumeField = saleType === "retail" ? "retailVolume" : "starterVolume"

    // Seller: pv + gv + retailVolume|starterVolume
    deltaMap.set(sellerId, { pv: volume, gv: volume, [volumeField]: volume })

    // Build a lookup map from beneficiary id to amount
    const beneficiaryMap = new Map(beneficiaries.map((b) => [b.id, b.amount]))

    // Ancestors: gv for each; also commissionEarned if they are a paid beneficiary
    const ancestors = sellerPath.split("/").slice(0, -1)
    for (const ancestorId of ancestors) {
      const existing = deltaMap.get(ancestorId) ?? {}
      existing.gv = (existing.gv ?? 0) + volume
      if (beneficiaryMap.has(ancestorId)) {
        existing.commissionEarned = (existing.commissionEarned ?? 0) + beneficiaryMap.get(ancestorId)!
      }
      deltaMap.set(ancestorId, existing)
    }

    // Build TransactWriteItems: idempotency marker Put + one Update per map entry
    const TransactItems: object[] = [
      {
        Put: {
          TableName: TABLE_NAME,
          Item: {
            PK: keys.eventPK(event.id),
            SK: "APPLIED",
            appliedAt: new Date().toISOString(),
          },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      },
      ...Array.from(deltaMap.entries()).map(([id, fields]) =>
        volumeAddAction(id, period, fields),
      ),
    ]

    try {
      await docClient.send(new TransactWriteCommand({ TransactItems }))
    } catch (e: unknown) {
      // Check if this is a TransactionCanceledException with ConditionalCheckFailed on the marker
      const err = e as { name?: string; CancellationReasons?: { Code?: string }[] }
      if (
        err.name === "TransactionCanceledException" &&
        Array.isArray(err.CancellationReasons) &&
        err.CancellationReasons.some((r) => r?.Code === "ConditionalCheckFailed")
      ) {
        // Event already applied — treat as success, fall through to mark processed
        console.log(`[drain] Event ${event.id} already applied (idempotency marker exists)`)
      } else {
        // Unexpected error — log and skip (leave for retry)
        console.error(`[drain] Failed to apply event ${event.id}:`, e)
        continue
      }
    }

    // Collect every node on the seller's path — each is a subtree root whose health changed.
    // sellerPath is root → seller (e.g. "001/003/009"), so split gives all affected root ids.
    for (const rootId of sellerPath.split("/")) {
      affectedRootPeriods.add(`${rootId}|${period}`)
    }

    // Mark outbox row as processed AFTER successful DynamoDB apply
    await markOutboxProcessed(event.id)
    count++
  }

  // After the per-event apply loop, recompute health rollups once per unique (root, period).
  // Health rollup failures must never fail the drain — money/aggregates already applied.
  for (const key of affectedRootPeriods) {
    const [rootId, period] = key.split("|") as [string, string]
    try {
      const health = await getNetworkHealth(rootId)
      await putHealthRollup(rootId, health.period, health)
    } catch (e) {
      console.error("[drain] health rollup failed for", rootId, e)
    }
  }

  return count
}
