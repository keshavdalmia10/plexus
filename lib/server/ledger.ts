import type { PoolClient } from "pg"
import { getPool, occRetry } from "./dsql"
import { computeCommissions, type CommissionLine } from "@/lib/commission"
import type { LedgerEntry, Sale } from "@/lib/types"

export interface LedgerRow {
  txn_id: string; sale_id: string; beneficiary_id: string; source_id: string
  source_name: string | null; level: number; amount: string; period: string
  created_at: Date
}

export function toLedgerEntry(r: LedgerRow): LedgerEntry {
  return {
    txnId: r.txn_id, beneficiaryId: r.beneficiary_id, sourceDistId: r.source_id,
    sourceName: r.source_name ?? undefined, level: Number(r.level),
    amount: Number(r.amount), period: r.period,
    timestamp: r.created_at.toISOString(),
  }
}

export interface SaleTxnInput {
  sale: Sale
  sellerName: string
  commissions: CommissionLine[]
  period: string
  /** Phase C: when set, an outbox row commits atomically with the sale. */
  outboxPayload?: object
}

/**
 * THE money write. Sale + every ledger row (+ outbox row) commit in ONE
 * DSQL transaction — a partial payout is impossible. ON CONFLICT DO NOTHING
 * on deterministic PKs makes the whole operation idempotent under retry.
 */
export async function insertSaleTxn(input: SaleTxnInput): Promise<void> {
  await occRetry(async () => {
    const client = await getPool().connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO sales (sale_id, seller_id, product_id, amount, volume, sale_type, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (sale_id) DO NOTHING`,
        [input.sale.saleId, input.sale.distributorId, input.sale.productId,
         input.sale.amount, input.sale.volume, input.sale.type, input.sale.timestamp],
      )
      for (const c of input.commissions) {
        await client.query(
          `INSERT INTO ledger (txn_id, sale_id, beneficiary_id, source_id, source_name, level, amount, period, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (txn_id) DO NOTHING`,
          [c.txnId, input.sale.saleId, c.beneficiaryId, input.sale.distributorId,
           input.sellerName, c.level, c.amount, input.period, input.sale.timestamp],
        )
      }
      if (input.outboxPayload) {
        await client.query(
          `INSERT INTO outbox (event_type, payload) VALUES ('sale.recorded', $1)`,
          [JSON.stringify(input.outboxPayload)],
        )
      }
      await client.query("COMMIT")
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {})
      throw e
    } finally {
      client.release()
    }
  })
}

export async function getLedgerFeed(beneficiaryId: string, limit = 25): Promise<LedgerEntry[]> {
  const res = await getPool().query<LedgerRow>(
    `SELECT txn_id, sale_id, beneficiary_id, source_id, source_name, level, amount, period, created_at
     FROM ledger WHERE beneficiary_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [beneficiaryId, limit],
  )
  return res.rows.map(toLedgerEntry)
}

/** Monthly statement — the SQL-auditability story (access pattern #10). */
export async function getStatement(beneficiaryId: string, period: string) {
  const res = await getPool().query(
    `SELECT l.period, COUNT(*)::int AS txn_count, SUM(l.amount)::float8 AS total,
            COUNT(DISTINCT l.sale_id)::int AS sales_count
     FROM ledger l WHERE l.beneficiary_id = $1 AND l.period = $2 GROUP BY l.period`,
    [beneficiaryId, period],
  )
  return res.rows[0] ?? { period, txn_count: 0, total: 0, sales_count: 0 }
}

/** Reconciliation source: per-beneficiary-per-period ledger sums. */
export async function getLedgerSums(): Promise<
  { beneficiary_id: string; period: string; total: number }[]
> {
  const res = await getPool().query(
    `SELECT beneficiary_id, period, SUM(amount)::float8 AS total
     FROM ledger GROUP BY beneficiary_id, period`,
  )
  return res.rows
}

export { computeCommissions }
export type { PoolClient }
