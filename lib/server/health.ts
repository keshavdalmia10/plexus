import { getDistributor, getSubtree, getVolumes } from "./repository"
import {
  currentPeriod,
  type HealthNode,
  type NetworkHealth,
} from "@/lib/types"

const STARTER_FLAG_THRESHOLD = 0.7

/**
 * Computes a health report for a distributor's subtree. The score rewards
 * genuine retail volume over starter/sign-up volume. Each node's subtree
 * (itself + descendants) is aggregated; subtrees where starter volume
 * dominates (>70%) are flagged.
 */
export async function getNetworkHealth(rootId: string): Promise<NetworkHealth> {
  const root = await getDistributor(rootId)
  if (!root) throw new Error(`Unknown distributor: ${rootId}`)

  const period = currentPeriod()
  const members = await getSubtree(root.path)
  const volumes = await getVolumes(
    members.map((m) => m.id),
    period,
  )

  // Subtree aggregation: a node's path is a prefix of all its descendants'
  // paths, so accumulate each member's own volume into every ancestor that
  // lives inside this subtree.
  const own = new Map<string, { retail: number; starter: number }>()
  for (const m of members) {
    const v = volumes.get(m.id)
    own.set(m.id, {
      retail: v?.retailVolume ?? 0,
      starter: v?.starterVolume ?? 0,
    })
  }

  const subtreeTotals = new Map<string, { retail: number; starter: number }>()
  for (const m of members) subtreeTotals.set(m.id, { retail: 0, starter: 0 })

  const rootDepth = root.path.split("/").length
  for (const m of members) {
    const segments = m.path.split("/")
    const o = own.get(m.id) ?? { retail: 0, starter: 0 }
    // Ancestors within the subtree (from root of subtree down to self)
    for (let i = rootDepth - 1; i < segments.length; i++) {
      const ancestorId = segments[i]
      const t = subtreeTotals.get(ancestorId)
      if (t) {
        t.retail += o.retail
        t.starter += o.starter
      }
    }
  }

  const nodes: HealthNode[] = members.map((m) => {
    const t = subtreeTotals.get(m.id) ?? { retail: 0, starter: 0 }
    const total = t.retail + t.starter
    const starterShare = total > 0 ? t.starter / total : 0
    return {
      id: m.id,
      name: m.name,
      path: m.path,
      depth: m.depth,
      rank: m.rank,
      status: m.status,
      subtreeRetail: round2(t.retail),
      subtreeStarter: round2(t.starter),
      subtreeTotal: round2(total),
      starterShare: Math.round(starterShare * 1000) / 1000,
      flagged: total > 0 && starterShare > STARTER_FLAG_THRESHOLD,
    }
  })

  const rootNode = nodes.find((n) => n.id === rootId)
  const totalRetail = rootNode?.subtreeRetail ?? 0
  const totalStarter = rootNode?.subtreeStarter ?? 0
  const grand = totalRetail + totalStarter
  const score = grand > 0 ? Math.round((totalRetail / grand) * 100) : 100

  nodes.sort((a, b) => a.path.localeCompare(b.path))

  return {
    rootId,
    period,
    score,
    totalRetail,
    totalStarter,
    nodes,
    flagged: nodes
      .filter((n) => n.flagged)
      .sort((a, b) => b.starterShare - a.starterShare),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
