import { randomUUID } from "node:crypto"
import { computeCommissions, round2 } from "@/lib/commission"
import { insertSaleTxn } from "./ledger"
import { addToVolume, getDistributor } from "./repository"
import { currentPeriod, type LedgerEntry, type Sale, type SaleType } from "@/lib/types"

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

/**
 * The commission engine (spec §4).
 * 1. Upline from the DynamoDB materialized path — zero traversal.
 * 2. ONE ACID DSQL transaction: sale + all ledger rows (deterministic txn_ids).
 * 3. Propagate derived aggregates to DynamoDB via atomic ADDs (Phase B: sync).
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

  // 2 — money, atomically
  await insertSaleTxn({ sale, sellerName: seller.name, commissions, period })

  // 3 — derived read models (sync in Phase B; outbox-driven in Phase C)
  await propagateAggregates(sale, seller.path, commissions, period)

  return {
    sale,
    commissions: commissions.map((c) => ({
      txnId: c.txnId, beneficiaryId: c.beneficiaryId, sourceDistId: seller.id,
      sourceName: seller.name, level: c.level, amount: c.amount,
      period, timestamp: iso,
    })),
  }
}

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
