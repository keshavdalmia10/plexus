import { config } from "dotenv"
config({ path: ".env.local" })

/**
 * Wipe and re-seed both stores (DynamoDB network + Aurora DSQL ledger),
 * reconciled by construction. Idempotent: deterministic ids + a no-Scan wipe.
 * Usage: pnpm exec tsx scripts/reseed.ts
 */
async function main() {
  const { reseed } = await import("../lib/server/seed")
  const counts = await reseed()
  console.log("reseed complete:", counts)
  process.exit(0)
}

main().catch((e) => {
  console.error("reseed failed:", e)
  process.exit(1)
})
