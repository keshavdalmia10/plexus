/**
 * scripts/acceptance-p3.ts
 *
 * Phase-C acceptance gate. Proves the transactional-outbox guarantees:
 *   - the outbox row commits atomically with the money (same DSQL txn)
 *   - crash survival + exactly-once application via the EVENT# marker
 *   - the /health route degrades gracefully to live compute when the rollup
 *     is missing (drainer/rollup absent)
 *   - Phase-B invariants still reconcile after outbox-based propagation
 *
 * Runs all checks, exits non-zero on ANY failure.
 * Usage: pnpm exec tsx scripts/acceptance-p3.ts
 *
 * dotenv is loaded synchronously first; all AWS-SDK modules are then dynamically
 * imported so that DynamoDB client (dynamo.ts, eagerly initialised) and the DSQL
 * pool see the env vars before they run.
 */

import { config } from "dotenv"
config({ path: ".env.local" })

let failures = 0
const TOTAL_CHECKS = 5

function pass(check: number, label: string) {
  console.log(`[CHECK ${check}] PASS — ${label}`)
}

function fail(check: number, label: string, reason?: string) {
  failures++
  console.error(`[CHECK ${check}] FAIL — ${label}${reason ? `: ${reason}` : ""}`)
}

async function main() {
  // All imports happen here, after dotenv has populated process.env
  const { reseed } = await import("../lib/server/seed")
  const { insertSaleTxn, listPendingOutbox, getLedgerSums } = await import(
    "../lib/server/ledger"
  )
  const { drainOutbox } = await import("../lib/server/engine")
  const { getVolume, setPlan, getDistributor, putHealthRollup } = await import(
    "../lib/server/repository"
  )
  const { getNetworkHealth } = await import("../lib/server/health")
  const { getPool } = await import("../lib/server/dsql")
  const { docClient, keys, TABLE_NAME } = await import("../lib/server/dynamo")
  const { DeleteCommand } = await import("@aws-sdk/lib-dynamodb")
  const { currentPeriod } = await import("../lib/types")

  console.log("=== Plexus Phase-C Acceptance Gate ===\n")

  // ------------------------------------------------------------------ CHECK 0
  console.log("[CHECK 0] Fresh state — reseed...")
  try {
    const counts = await reseed()
    console.log(
      `  reseed complete: sellers=${counts.sellers} sales=${counts.sales} ledgerRows=${counts.ledgerRows}`,
    )
    pass(
      0,
      `Reseed OK (${counts.sellers} sellers, ${counts.sales} sales, ${counts.ledgerRows} ledger rows)`,
    )
  } catch (e) {
    fail(0, "reseed()", String(e))
  }

  // The throwaway sale used by Checks 1 & 2. insertSaleTxn is called DIRECTLY
  // (NOT recordSale) so no auto-drain fires — we simulate an app that committed
  // the money + outbox row, then crashed before propagating aggregates.
  const dd01SaleId = "00000000-0000-4000-8000-00000000dd01"
  const period = currentPeriod()

  // Defensive pre-cleanup so reruns start clean.
  await getPool()
    .query("DELETE FROM ledger WHERE sale_id = $1", [dd01SaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM sales WHERE sale_id = $1", [dd01SaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM outbox WHERE payload->>'saleId' = $1", [dd01SaleId])
    .catch(() => {})

  // ------------------------------------------------------------------ CHECK 1
  console.log(
    "\n[CHECK 1] Outbox commits atomically with the money (same DSQL transaction)...",
  )
  try {
    const seller038 = await getDistributor("038")
    if (!seller038) throw new Error("seed missing distributor 038")
    const sellerPath = seller038.path

    // 2 commissions + an inline outbox payload. The L1 beneficiary of 038's
    // upline is 035 (10% of volume 100 = 10); add a second ledger row so the
    // assertion below (2 ledger rows) is meaningful.
    const commissions = [
      { txnId: "dd01-c1", beneficiaryId: "035", level: 1, amount: 10 },
      { txnId: "dd01-c2", beneficiaryId: "029", level: 2, amount: 5 },
    ]
    const outboxPayload = {
      saleId: dd01SaleId,
      sellerId: "038",
      sellerPath,
      period,
      volume: 100,
      saleType: "retail" as const,
      beneficiaries: [{ id: "035", amount: 10 }],
    }

    await insertSaleTxn({
      sale: {
        saleId: dd01SaleId,
        distributorId: "038",
        productId: "SKU-DD01",
        amount: 100,
        volume: 100,
        type: "retail",
        timestamp: new Date().toISOString(),
      },
      sellerName: "Wendy Lau",
      commissions,
      period,
      outboxPayload,
    })

    const salesRes = await getPool().query<{ n: string }>(
      "SELECT count(*)::int n FROM sales WHERE sale_id = $1",
      [dd01SaleId],
    )
    const ledgerRes = await getPool().query<{ n: string }>(
      "SELECT count(*)::int n FROM ledger WHERE sale_id = $1",
      [dd01SaleId],
    )
    const outboxRes = await getPool().query<{ n: string }>(
      "SELECT count(*)::int n FROM outbox WHERE payload->>'saleId' = $1 AND processed_at IS NULL",
      [dd01SaleId],
    )
    const salesN = Number(salesRes.rows[0].n)
    const ledgerN = Number(ledgerRes.rows[0].n)
    const outboxN = Number(outboxRes.rows[0].n)
    console.log(
      `  same-commit rows: sales=${salesN} ledger=${ledgerN} pendingOutbox=${outboxN}`,
    )

    if (salesN === 1 && ledgerN === 2 && outboxN >= 1) {
      pass(
        1,
        `Money + outbox landed in one commit (sales=1, ledger=2, pending outbox=${outboxN})`,
      )
    } else {
      fail(
        1,
        "Outbox atomicity",
        `expected sales=1, ledger=2, pendingOutbox>=1; got sales=${salesN} ledger=${ledgerN} outbox=${outboxN}`,
      )
    }
  } catch (e) {
    fail(1, "Outbox atomicity threw", String(e))
  }

  // ------------------------------------------------------------------ CHECK 2
  console.log(
    "\n[CHECK 2] Crash survival + exactly-once (the headline Phase-C proof)...",
  )
  try {
    // BEFORE draining: 035's commissionEarned must NOT yet reflect the dd01 sale
    // (insertSaleTxn applied money + outbox only — no propagation; the "crash").
    const before035 = (await getVolume("035", period)).commissionEarned

    // The durable record survived the "crash": a pending outbox row exists.
    const pendingBefore = await listPendingOutbox(100)
    const dd01Pending = pendingBefore.filter(
      (p) => (p.payload as { saleId?: string }).saleId === dd01SaleId,
    )
    const crashDurable = dd01Pending.length >= 1
    console.log(
      `  before drain: 035.commissionEarned=${before035} | pending dd01 outbox rows=${dd01Pending.length}`,
    )

    // First drain → recovers the un-applied event, applies +10 to 035.
    const drained1 = await drainOutbox(100)
    const after035 = (await getVolume("035", period)).commissionEarned
    const delta1 = Math.round((after035 - before035) * 100) / 100
    console.log(
      `  drain #1: processed=${drained1} | 035.commissionEarned ${before035} -> ${after035} (delta=${delta1})`,
    )

    // Second drain → MUST be a no-op (exactly-once via the EVENT# marker).
    const drained2 = await drainOutbox(100)
    const after035b = (await getVolume("035", period)).commissionEarned
    const delta2 = Math.round((after035b - after035) * 100) / 100
    const pendingAfter = await listPendingOutbox(100)
    console.log(
      `  drain #2: processed=${drained2} | 035.commissionEarned ${after035} -> ${after035b} (delta=${delta2}) | pendingOutbox now=${pendingAfter.length}`,
    )

    const firstApplied = Math.abs(delta1 - 10) < 0.01
    const secondNoop = Math.abs(delta2) < 0.01
    const queueEmpty = pendingAfter.length === 0

    if (crashDurable && firstApplied && secondNoop && queueEmpty) {
      pass(
        2,
        `Crash left durable outbox row; drain #1 applied +10 (035: ${before035}->${after035}); drain #2 no-op (exactly-once); queue empty`,
      )
    } else {
      fail(
        2,
        "Crash survival / exactly-once",
        `crashDurable=${crashDurable} firstApplied=${firstApplied}(delta=${delta1}) secondNoop=${secondNoop}(delta=${delta2}) queueEmpty=${queueEmpty}`,
      )
    }
  } catch (e) {
    fail(2, "Crash survival / exactly-once threw", String(e))
  } finally {
    // Clean up the throwaway sale's DSQL rows.
    await getPool()
      .query("DELETE FROM ledger WHERE sale_id = $1", [dd01SaleId])
      .catch(() => {})
    await getPool()
      .query("DELETE FROM sales WHERE sale_id = $1", [dd01SaleId])
      .catch(() => {})
    await getPool()
      .query("DELETE FROM outbox WHERE payload->>'saleId' = $1", [dd01SaleId])
      .catch(() => {})
  }

  // ------------------------------------------------------------------ CHECK 3
  console.log(
    "\n[CHECK 3] Health route graceful degradation when the rollup is missing...",
  )
  try {
    // Pick a Pro seller: upgrade 001 to pro.
    await setPlan("001", "pro")

    // Ensure a rollup exists (reseed wrote one; write it again to be sure).
    const liveHealth = await getNetworkHealth("001")
    await putHealthRollup("001", liveHealth.period, liveHealth)

    // DELETE the HEALTH rollup item for 001 directly from DynamoDB.
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: keys.dist("001"), SK: keys.health(currentPeriod()) },
      }),
    )

    // Call the health route handler — must fall back to live compute.
    const { GET } = await import("../app/api/distributors/[id]/health/route")
    const resp = await GET(new Request("http://x"), {
      params: Promise.resolve({ id: "001" }),
    })
    const body = (await resp.json()) as Record<string, unknown>
    console.log(
      `  route status=${resp.status} source=${body.source} score=${body.score} gated=${body.gated}`,
    )

    if (
      resp.status === 200 &&
      body.source === "live" &&
      typeof body.score === "number"
    ) {
      pass(
        3,
        `Health route degraded gracefully: HTTP 200, source="live", score=${body.score}`,
      )
    } else {
      fail(
        3,
        "Health graceful degradation",
        `expected status=200 source=live numeric score; got status=${resp.status} ${JSON.stringify(body)}`,
      )
    }
  } catch (e) {
    fail(3, "Health graceful degradation threw", String(e))
  } finally {
    // Restore 001 to free so Check 4's reseed/reconcile starts clean.
    try {
      await setPlan("001", "free")
      console.log("  [3] Restored 001 plan to free")
    } catch (e) {
      console.error("  [3] WARNING: failed to restore 001 to free:", e)
    }
  }

  // ------------------------------------------------------------------ CHECK 4
  console.log(
    "\n[CHECK 4] Full Phase-B invariants still hold — reseed then reconcile (zero mismatches)...",
  )
  try {
    const counts = await reseed()
    console.log(
      `  reseed: sellers=${counts.sellers} sales=${counts.sales} ledgerRows=${counts.ledgerRows}`,
    )
    const sums = await getLedgerSums()
    let mismatches = 0
    for (const s of sums) {
      const v = await getVolume(s.beneficiary_id, s.period)
      const diff = Math.abs(s.total - v.commissionEarned)
      if (diff > 0.01) {
        console.error(
          `  MISMATCH: beneficiary=${s.beneficiary_id} period=${s.period} ledger=${s.total} ddb=${v.commissionEarned} diff=${diff}`,
        )
        mismatches++
      }
    }
    if (mismatches === 0) {
      pass(
        4,
        `Reconcile OK: zero mismatches across ${sums.length} beneficiary-periods (outbox propagation keeps stores in sync)`,
      )
    } else {
      fail(4, "Phase-B reconcile", `${mismatches} mismatch(es) > $0.01`)
    }
  } catch (e) {
    fail(4, "Phase-B reconcile threw", String(e))
  }

  // ------------------------------------------------------------------ SUMMARY
  const passed = TOTAL_CHECKS - failures
  console.log(`\n${"=".repeat(40)}`)
  console.log(`PHASE-C ACCEPTANCE: ${passed}/${TOTAL_CHECKS} checks passed`)
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`)
  }

  await getPool().end()
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  console.error("Unhandled error:", err)
  process.exit(1)
})
