/**
 * scripts/reconcile.ts
 *
 * Reconcile DSQL ledger sums against DynamoDB aggregates.
 * Usage: pnpm exec tsx scripts/reconcile.ts
 *
 * dotenv MUST be loaded before any module that touches DynamoDB (dynamo.ts
 * initialises the client eagerly at module scope). We load dotenv first, then
 * use dynamic imports so every AWS-SDK module resolves after env vars are set.
 */

import { config } from "dotenv"
config({ path: ".env.local" })

async function main() {
  // Dynamic imports ensure dynamo.ts (and dsql.ts) see env vars already set
  const { getLedgerSums } = await import("../lib/server/ledger")
  const { getVolume } = await import("../lib/server/repository")
  const { getPool } = await import("../lib/server/dsql")

  const sums = await getLedgerSums()

  interface ReconcileRow {
    beneficiary: string
    period: string
    ledger: number
    ddb: number
    diff: number
  }

  const rows: ReconcileRow[] = []
  const mismatches: ReconcileRow[] = []

  for (const s of sums) {
    const v = await getVolume(s.beneficiary_id, s.period)
    const diff = Math.abs(s.total - v.commissionEarned)
    const row: ReconcileRow = {
      beneficiary: s.beneficiary_id,
      period: s.period,
      ledger: s.total,
      ddb: v.commissionEarned,
      diff,
    }
    rows.push(row)
    if (diff > 0.01) mismatches.push(row)
  }

  console.table(rows)

  if (mismatches.length > 0) {
    console.error(`RECONCILE FAILED: ${mismatches.length} mismatches`)
    await getPool().end()
    process.exit(1)
  } else {
    console.log(`RECONCILE OK: ${rows.length} beneficiary-periods match`)
    await getPool().end()
    process.exit(0)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
