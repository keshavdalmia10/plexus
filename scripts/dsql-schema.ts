import { config } from "dotenv"
import { getPool } from "../lib/server/dsql"

config({ path: ".env.local" })

// DSQL adaptations vs the spec's reference DDL:
// - no FOREIGN KEY support -> relationship enforced in code
// - no sequences/identity  -> outbox UUID pk, ordered by created_at
// - CREATE INDEX ASYNC     -> DSQL builds indexes via async jobs
const statements = [
  `CREATE TABLE IF NOT EXISTS sales (
     sale_id    UUID PRIMARY KEY,
     seller_id  TEXT NOT NULL,
     product_id TEXT,
     amount     NUMERIC(12,2) NOT NULL,
     volume     NUMERIC(12,2) NOT NULL,
     sale_type  TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ledger (
     txn_id         TEXT PRIMARY KEY,
     sale_id        UUID NOT NULL,
     beneficiary_id TEXT NOT NULL,
     source_id      TEXT NOT NULL,
     source_name    TEXT,
     level          INT NOT NULL,
     amount         NUMERIC(12,2) NOT NULL,
     period         TEXT NOT NULL,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS outbox (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     event_type   TEXT NOT NULL,
     payload      JSONB NOT NULL,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     processed_at TIMESTAMPTZ
   )`,
  // DSQL adaptation: DESC sort order not supported on index keys — omit DESC
  `CREATE INDEX ASYNC IF NOT EXISTS idx_ledger_beneficiary
     ON ledger (beneficiary_id, created_at)`,
  // DSQL adaptation: partial index WHERE clause not supported — plain index on created_at
  `CREATE INDEX ASYNC IF NOT EXISTS idx_outbox_pending
     ON outbox (created_at)`,
]

async function main() {
  const pool = getPool()
  for (const sql of statements) {
    console.log(sql.split("\n")[0], "…")
    await pool.query(sql)
  }
  console.log("schema OK")
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
