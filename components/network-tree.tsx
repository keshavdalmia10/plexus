"use client"

import useSWR from "swr"
import { useMemo, useState } from "react"
import { ChevronRight, Loader2, Users } from "lucide-react"
import { fetcher, useActingAs } from "@/components/acting-as"
import { Paywall, PaywallSkeletonRows } from "@/components/paywall"
import { formatVolume } from "@/lib/format"
import { FREE_NETWORK_DEPTH, type Distributor, type LockedLevels, type Rank } from "@/lib/types"

interface SubtreeMember extends Distributor {
  pv: number
  gv: number
}

interface SubtreeResponse {
  root: Distributor
  period: string
  locked: LockedLevels | null
  members: SubtreeMember[]
}

interface TreeNodeData extends SubtreeMember {
  children: TreeNodeData[]
}

const RANK_STYLES: Record<Rank, string> = {
  Diamond: "bg-accent text-accent-foreground",
  Executive: "bg-primary/10 text-primary",
  Director: "bg-chart-4/20 text-foreground",
  Builder: "bg-secondary text-secondary-foreground",
  Associate: "bg-muted text-muted-foreground",
}

function buildTree(members: SubtreeMember[], rootId: string): TreeNodeData | null {
  const map = new Map<string, TreeNodeData>()
  for (const m of members) map.set(m.id, { ...m, children: [] })
  let root: TreeNodeData | null = null
  for (const node of map.values()) {
    if (node.id === rootId) {
      root = node
    } else if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)?.children.push(node)
    }
  }
  for (const node of map.values()) {
    node.children.sort((a, b) => b.gv - a.gv)
  }
  return root
}

function RankBadge({ rank }: { rank: Rank }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${RANK_STYLES[rank]}`}
    >
      {rank}
    </span>
  )
}

function TreeNode({
  node,
  depth,
  isLast,
}: {
  node: TreeNodeData
  depth: number
  isLast: boolean
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children.length > 0

  return (
    <li className={depth > 0 ? "relative pl-5 sm:pl-6" : ""}>
      {depth > 0 && (
        <>
          <span
            aria-hidden="true"
            className={`absolute left-0 top-0 w-px bg-border ${isLast ? "h-7" : "h-full"}`}
          />
          <span
            aria-hidden="true"
            className="absolute left-0 top-7 h-px w-4 bg-border sm:w-5"
          />
        </>
      )}
      <div
        className={`flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 shadow-sm sm:gap-3 ${
          node.status === "inactive" ? "border-border opacity-60" : "border-border"
        }`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight
              className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm font-medium">{node.name}</span>
          <RankBadge rank={node.rank} />
          {node.status === "inactive" && (
            <span className="text-xs text-muted-foreground">Inactive</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4 text-right">
          <div className="hidden sm:block">
            <p className="text-xs text-muted-foreground">PV</p>
            <p className="tabular text-sm font-medium">
              {formatVolume(node.pv)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">GV</p>
            <p className="tabular text-sm font-medium">
              {formatVolume(node.gv)}
            </p>
          </div>
          {hasChildren && (
            <div className="hidden items-center gap-1 text-muted-foreground sm:flex">
              <Users className="size-3.5" aria-hidden="true" />
              <span className="tabular text-xs">{node.children.length}</span>
            </div>
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <ul className="mt-2 flex flex-col gap-2">
          {node.children.map((child, i) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              isLast={i === node.children.length - 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function NetworkTree() {
  const { actingAs } = useActingAs()
  const { data, isLoading, error } = useSWR<SubtreeResponse>(
    `/api/distributors/${actingAs}/subtree`,
    fetcher,
    { refreshInterval: 5000 },
  )

  const tree = useMemo(
    () => (data ? buildTree(data.members, actingAs) : null),
    [data, actingAs],
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading network</span>
      </div>
    )
  }

  if (error || !tree) {
    return (
      <p className="py-24 text-center text-sm text-muted-foreground">
        Could not load the network tree. Try refreshing.
      </p>
    )
  }

  const locked = data?.locked
  const lockedLevelLabel = locked
    ? locked.levels.length === 1
      ? `level ${locked.levels[0]}`
      : `levels ${locked.levels[0]}\u2013${locked.levels[locked.levels.length - 1]}`
    : ""

  return (
    <section aria-label="Your network genealogy tree" className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Your network</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Everyone you&apos;ve brought in, and their teams. PV is each
          person&apos;s own sales volume this month; GV includes everyone
          underneath them. Branches are sorted by group volume.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        <TreeNode node={tree} depth={0} isLast />
      </ul>

      {locked && (
        <Paywall
          title="Upgrade to Pro to see your full network"
          description={`${locked.memberCount} more ${locked.memberCount === 1 ? "member" : "members"} in ${lockedLevelLabel} of your network. Free shows levels 1\u2013${FREE_NETWORK_DEPTH}.`}
        >
          <PaywallSkeletonRows rows={Math.min(locked.memberCount, 5)} />
        </Paywall>
      )}
    </section>
  )
}
