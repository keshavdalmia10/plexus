/**
 * scripts/acceptance-p2.ts
 *
 * Phase-B acceptance gate. Runs all checks, exits non-zero on ANY failure.
 * Usage: pnpm exec tsx scripts/acceptance-p2.ts
 *
 * dotenv is loaded synchronously first; all AWS-SDK modules are then dynamically
 * imported so that DynamoDB client (dynamo.ts, which is eagerly initialised)
 * and DSQL pool see the env vars before they run.
 */

import { config } from "dotenv"
config({ path: ".env.local" })

let failures = 0
const TOTAL_CHECKS = 7

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
  const { getLedgerSums, getLedgerFeed, getStatement, insertSaleTxn } = await import(
    "../lib/server/ledger"
  )
  const { getVolume, setPlan } = await import("../lib/server/repository")
  const { recordSale } = await import("../lib/server/engine")
  const { getPool } = await import("../lib/server/dsql")
  const { currentPeriod } = await import("../lib/types")

  // Inline reconcile helper — mirrors reconcile.ts logic
  async function runReconcile(): Promise<number> {
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
    return mismatches
  }

  console.log("=== Plexus Phase-B Acceptance Gate ===\n")

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

  // ------------------------------------------------------------------ CHECK 1
  console.log("\n[CHECK 1] Reconcile after seed — ledger sums vs DDB aggregates...")
  try {
    const mismatches = await runReconcile()
    if (mismatches === 0) {
      const sums = await getLedgerSums()
      pass(1, `Zero mismatches across ${sums.length} beneficiary-periods`)
    } else {
      fail(1, `Reconcile after seed`, `${mismatches} mismatch(es) > $0.01`)
    }
  } catch (e) {
    fail(1, "Reconcile after seed threw", String(e))
  }

  // ------------------------------------------------------------------ CHECK 2
  console.log(
    "\n[CHECK 2] Atomicity — numeric overflow must roll back entire transaction...",
  )
  const atomicSaleId = "00000000-0000-4000-8000-0000000000aa"
  // Defensive pre-cleanup
  await getPool()
    .query("DELETE FROM ledger WHERE sale_id = $1", [atomicSaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM sales WHERE sale_id = $1", [atomicSaleId])
    .catch(() => {})

  try {
    await insertSaleTxn({
      sale: {
        saleId: atomicSaleId,
        distributorId: "014",
        productId: "SKU-ATOM",
        amount: 99,
        volume: 99,
        type: "retail",
        timestamp: new Date().toISOString(),
      },
      sellerName: "X",
      commissions: [
        { txnId: "atom-1", beneficiaryId: "014", level: 1, amount: 10 },
        // This amount (1e11) overflows NUMERIC(12,2) — must cause rollback of the whole txn
        { txnId: "atom-2", beneficiaryId: "001", level: 2, amount: 100_000_000_000 },
      ],
      period: "2099-12",
    })
    // If we reach here, no error was thrown — that's a FAIL
    fail(
      2,
      "Atomicity",
      "insertSaleTxn did NOT throw on overflow — expected numeric overflow error",
    )
  } catch {
    // Expected path — verify both tables rolled back
    try {
      const salesCount = await getPool().query<{ n: string }>(
        "SELECT count(*)::int n FROM sales WHERE sale_id = $1",
        [atomicSaleId],
      )
      const ledgerCount = await getPool().query<{ n: string }>(
        "SELECT count(*)::int n FROM ledger WHERE sale_id = $1",
        [atomicSaleId],
      )
      const salesN = Number(salesCount.rows[0].n)
      const ledgerN = Number(ledgerCount.rows[0].n)
      if (salesN === 0 && ledgerN === 0) {
        pass(
          2,
          `Rollback verified: sales=${salesN} ledger=${ledgerN} for sale_id=${atomicSaleId}`,
        )
      } else {
        fail(
          2,
          "Atomicity rollback",
          `Expected 0 rows but found sales=${salesN} ledger=${ledgerN}`,
        )
      }
    } catch (e2) {
      fail(2, "Atomicity DSQL verify query failed", String(e2))
    }
  }
  // Defensive post-cleanup
  await getPool()
    .query("DELETE FROM ledger WHERE sale_id = $1", [atomicSaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM sales WHERE sale_id = $1", [atomicSaleId])
    .catch(() => {})

  // ------------------------------------------------------------------ CHECK 3
  console.log(
    "\n[CHECK 3] Idempotency — double-call recordSale with same saleId yields 5 ledger rows...",
  )
  const idempSaleId = "00000000-0000-4000-8000-0000000000bb"
  // Defensive pre-cleanup
  await getPool()
    .query("DELETE FROM ledger WHERE sale_id = $1", [idempSaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM sales WHERE sale_id = $1", [idempSaleId])
    .catch(() => {})

  try {
    // First call
    await recordSale({
      distributorId: "038",
      productId: "SKU-A",
      amount: 100,
      volume: 100,
      type: "retail",
      saleId: idempSaleId,
    })
    // Second call — DSQL side idempotent via ON CONFLICT DO NOTHING on deterministic PKs
    await recordSale({
      distributorId: "038",
      productId: "SKU-A",
      amount: 100,
      volume: 100,
      type: "retail",
      saleId: idempSaleId,
    })

    const res = await getPool().query<{ n: string }>(
      "SELECT count(*)::int n FROM ledger WHERE sale_id = $1",
      [idempSaleId],
    )
    const n = Number(res.rows[0].n)
    if (n === 5) {
      pass(3, `Idempotency OK: exactly ${n} ledger rows (not 10) for double-submitted sale`)
    } else {
      fail(3, "Idempotency", `Expected 5 ledger rows but found ${n}`)
    }
  } catch (e) {
    fail(3, "Idempotency recordSale threw", String(e))
  }
  // Clean up
  await getPool()
    .query("DELETE FROM ledger WHERE sale_id = $1", [idempSaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM sales WHERE sale_id = $1", [idempSaleId])
    .catch(() => {})

  // ------------------------------------------------------------------ CHECK 4
  console.log(
    "\n[CHECK 4] Correctness — 5-level cascade from distributor 038 (volume=100)...",
  )
  const cascSaleId = "00000000-0000-4000-8000-0000000000cc"
  // Defensive pre-cleanup
  await getPool()
    .query("DELETE FROM ledger WHERE sale_id = $1", [cascSaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM sales WHERE sale_id = $1", [cascSaleId])
    .catch(() => {})

  try {
    const result = await recordSale({
      distributorId: "038",
      productId: "SKU-B",
      amount: 100,
      volume: 100,
      type: "retail",
      saleId: cascSaleId,
    })

    const comms = result.commissions
    console.log(
      "  Returned commissions:",
      comms.map((c) => `L${c.level}=$${c.amount}->${c.beneficiaryId}`).join(", "),
    )

    // Expected: 5 entries with amounts [10, 5, 3, 2, 1] at levels [1..5]
    const expectedAmounts = [10, 5, 3, 2, 1]
    const expectedLevels = [1, 2, 3, 4, 5]
    const actualAmounts = comms.map((c) => c.amount)
    const actualLevels = comms.map((c) => c.level)

    const amountsMatch =
      comms.length === 5 &&
      actualAmounts.every((a, i) => Math.abs(a - expectedAmounts[i]) < 0.01)
    const levelsMatch =
      comms.length === 5 && actualLevels.every((l, i) => l === expectedLevels[i])

    if (!amountsMatch || !levelsMatch) {
      fail(
        4,
        "5-level cascade amounts/levels",
        `Got amounts=${JSON.stringify(actualAmounts)} levels=${JSON.stringify(actualLevels)}, expected amounts=[10,5,3,2,1] levels=[1,2,3,4,5]`,
      )
    } else {
      // Verify DSQL has exactly 5 ledger rows for this saleId
      const res = await getPool().query<{ n: string }>(
        "SELECT count(*)::int n FROM ledger WHERE sale_id = $1",
        [cascSaleId],
      )
      const n = Number(res.rows[0].n)
      if (n === 5) {
        pass(4, `Correct 5-level cascade: amounts=[10,5,3,2,1], ${n} DSQL ledger rows`)
      } else {
        fail(4, "DSQL ledger row count", `Expected 5 but found ${n}`)
      }
    }
  } catch (e) {
    fail(4, "Correctness recordSale threw", String(e))
  }
  // Clean up
  await getPool()
    .query("DELETE FROM ledger WHERE sale_id = $1", [cascSaleId])
    .catch(() => {})
  await getPool()
    .query("DELETE FROM sales WHERE sale_id = $1", [cascSaleId])
    .catch(() => {})

  // ------------------------------------------------------------------ CHECK 5
  console.log(
    "\n[CHECK 5] Statement matches feed — beneficiary 001, current period...",
  )
  try {
    const period = currentPeriod()
    const stmt = await getStatement("001", period)
    const feed = await getLedgerFeed("001", 1000)
    const periodFeed = feed.filter((e) => e.period === period)
    const feedTotal = periodFeed.reduce((sum, e) => sum + e.amount, 0)
    const diff = Math.abs((stmt.total ?? 0) - feedTotal)

    console.log(
      `  statement total=${stmt.total} txn_count=${stmt.txn_count} | feed rows=${periodFeed.length} feed_total=${feedTotal.toFixed(2)} diff=${diff.toFixed(4)}`,
    )

    if (diff < 0.01) {
      pass(5, `Statement matches feed (diff=${diff.toFixed(4)})`)
    } else {
      fail(5, "Statement vs feed mismatch", `diff=${diff.toFixed(4)}`)
    }
  } catch (e) {
    fail(5, "Statement/feed threw", String(e))
  }

  // ------------------------------------------------------------------ CHECK 6
  console.log(
    "\n[CHECK 6] API gating — free=gated, upgrade=unlocked, restore...",
  )
  try {
    // Dynamic import of route handlers (they use NextResponse, etc.)
    const { GET: healthGET } = await import(
      "../app/api/distributors/[id]/health/route"
    )
    const { GET: downlineGET } = await import(
      "../app/api/distributors/[id]/subtree/route"
    )
    const { POST: upgradePOST } = await import("../app/api/billing/upgrade/route")

    // 001 is "free" in a fresh seed (PRO_SELLERS = {002, 009})

    // A) Health for free seller 001 must be gated
    const freeHealthResp = await healthGET(new Request("http://x"), {
      params: Promise.resolve({ id: "001" }),
    })
    const freeHealth = (await freeHealthResp.json()) as Record<string, unknown>
    console.log(`  free health response: ${JSON.stringify(freeHealth)}`)

    let check6aOk = false
    if (freeHealth.gated !== true) {
      fail(
        6,
        "Free seller health gating",
        `expected gated=true, got: ${JSON.stringify(freeHealth)}`,
      )
    } else if ("score" in freeHealth) {
      fail(
        6,
        "Free seller health gating",
        "score should NOT be present for free seller",
      )
    } else {
      console.log("  [6a] free seller has gated=true and no score field")
      check6aOk = true
    }

    // B) Subtree for free seller 001 must have locked field (deep subtree exists)
    const freeDownlineResp = await downlineGET(new Request("http://x"), {
      params: Promise.resolve({ id: "001" }),
    })
    const freeDownline = (await freeDownlineResp.json()) as Record<string, unknown>
    console.log(
      `  free downline: locked=${JSON.stringify(freeDownline.locked)} memberCount=${(freeDownline.members as unknown[])?.length}`,
    )

    let check6bOk = false
    if (!freeDownline.locked) {
      fail(
        6,
        "Free seller subtree gating",
        "expected locked field for free seller with deep subtree",
      )
    } else {
      console.log("  [6b] free downline has locked field present")
      check6bOk = true
    }

    // C) Upgrade 001 to pro
    const upgradeResp = await upgradePOST(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ distributorId: "001" }),
      }),
    )
    const upgradeData = (await upgradeResp.json()) as {
      distributor?: { plan?: string }
    }
    console.log(`  upgrade response: plan=${upgradeData.distributor?.plan}`)

    let check6cOk = false
    if (upgradeData.distributor?.plan !== "pro") {
      fail(
        6,
        "Upgrade to pro",
        `expected plan=pro, got: ${JSON.stringify(upgradeData)}`,
      )
    } else {
      check6cOk = true
    }

    // D) Health for pro seller 001 must return real score
    const proHealthResp = await healthGET(new Request("http://x"), {
      params: Promise.resolve({ id: "001" }),
    })
    const proHealth = (await proHealthResp.json()) as Record<string, unknown>
    console.log(
      `  pro health response: score=${proHealth.score} gated=${proHealth.gated}`,
    )

    let check6dOk = false
    if (typeof proHealth.score !== "number" || proHealth.gated === true) {
      fail(
        6,
        "Pro seller health unlocked",
        `expected numeric score, no gated flag; got: ${JSON.stringify(proHealth)}`,
      )
    } else {
      check6dOk = true
    }

    if (check6aOk && check6bOk && check6cOk && check6dOk) {
      pass(
        6,
        `Gating correct: free=gated(no score), pro=unlocked(score=${proHealth.score})`,
      )
    }
  } catch (e) {
    fail(6, "API gating threw", String(e))
  } finally {
    // RESTORE: flip 001 back to free so Check 7's reconcile starts clean
    try {
      await setPlan("001", "free")
      console.log("  [6] Restored 001 plan to free")
    } catch (e) {
      console.error("  [6] WARNING: failed to restore 001 to free:", e)
    }
  }

  // ------------------------------------------------------------------ CHECK 7
  console.log(
    "\n[CHECK 7] Final reconcile — reseed then verify zero mismatches...",
  )
  try {
    const counts = await reseed()
    console.log(
      `  reseed: sellers=${counts.sellers} sales=${counts.sales} ledgerRows=${counts.ledgerRows}`,
    )
    const mismatches = await runReconcile()
    if (mismatches === 0) {
      const sums = await getLedgerSums()
      pass(
        7,
        `Final reconcile OK: zero mismatches across ${sums.length} beneficiary-periods`,
      )
    } else {
      fail(7, "Final reconcile", `${mismatches} mismatch(es) > $0.01`)
    }
  } catch (e) {
    fail(7, "Final reconcile threw", String(e))
  }

  // ------------------------------------------------------------------ SUMMARY
  const passed = TOTAL_CHECKS - failures
  console.log(`\n${"=".repeat(40)}`)
  console.log(`ACCEPTANCE: ${passed}/${TOTAL_CHECKS} checks passed`)
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
