export type Rank =
  | "Associate"
  | "Builder"
  | "Director"
  | "Executive"
  | "Diamond"

export type DistributorStatus = "active" | "inactive"

export type SaleType = "retail" | "starter"

export interface Distributor {
  id: string
  name: string
  parentId: string | null
  /** Slash-delimited ancestry path including self, e.g. "001/014/207" */
  path: string
  depth: number
  rank: Rank
  status: DistributorStatus
}

export interface Sale {
  saleId: string
  distributorId: string
  productId: string
  amount: number
  volume: number
  type: SaleType
  timestamp: string
}

export interface LedgerEntry {
  txnId: string
  beneficiaryId: string
  sourceDistId: string
  sourceName?: string
  level: number
  amount: number
  period: string
  timestamp: string
}

export interface VolumeAggregate {
  distributorId: string
  period: string
  pv: number
  gv: number
  retailVolume: number
  starterVolume: number
  commissionEarned: number
}

export interface DistributorSummary {
  distributor: Distributor
  volume: VolumeAggregate
  previousVolume: VolumeAggregate
}

export interface HealthNode {
  id: string
  name: string
  path: string
  depth: number
  rank: Rank
  status: DistributorStatus
  /** Subtree totals for the current period (node + all descendants) */
  subtreeRetail: number
  subtreeStarter: number
  subtreeTotal: number
  /** 0..1 share of starter volume in subtree */
  starterShare: number
  flagged: boolean
}

export interface NetworkHealth {
  rootId: string
  period: string
  /** 0-100, higher = more genuine retail volume */
  score: number
  totalRetail: number
  totalStarter: number
  nodes: HealthNode[]
  flagged: HealthNode[]
}

export const COMMISSION_RATES = [0.1, 0.05, 0.03, 0.02, 0.01] as const

export function currentPeriod(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export function previousPeriod(d: Date = new Date()): string {
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
  return currentPeriod(p)
}
