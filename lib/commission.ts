import { createHash } from "node:crypto"
import { COMMISSION_RATES } from "@/lib/types"

/** Ancestor ids from a materialized path, nearest-first, excluding self. */
export function ancestorsOf(path: string): string[] {
  return path.split("/").slice(0, -1).reverse()
}

export interface CommissionLine {
  txnId: string
  beneficiaryId: string
  level: number
  amount: number
}

/**
 * Unilevel payout: volume-based rates to the nearest maxDepth ancestors.
 * txn_id is a deterministic hash of (saleId, beneficiaryId) so a retried
 * sale can never double-insert a ledger row.
 */
export function computeCommissions(input: {
  saleId: string
  sellerPath: string
  volume: number
}): CommissionLine[] {
  return ancestorsOf(input.sellerPath)
    .slice(0, COMMISSION_RATES.length)
    .map((beneficiaryId, i) => ({
      txnId: deterministicTxnId(input.saleId, beneficiaryId),
      beneficiaryId,
      level: i + 1,
      amount: round2(input.volume * COMMISSION_RATES[i]),
    }))
}

export function deterministicTxnId(saleId: string, beneficiaryId: string): string {
  return createHash("sha256").update(`${saleId}:${beneficiaryId}`).digest("hex").slice(0, 32)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
