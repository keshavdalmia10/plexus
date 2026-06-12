"use client"

import useSWR from "swr"
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react"
import { fetcher, useActingAs } from "@/components/acting-as"
import { formatVolume } from "@/lib/format"
import type { HealthNode, NetworkHealth } from "@/lib/types"

function scoreTone(score: number): { label: string; className: string } {
  if (score >= 70)
    return { label: "Healthy", className: "text-primary" }
  if (score >= 40)
    return { label: "Needs attention", className: "text-chart-4" }
  return { label: "At risk", className: "text-destructive" }
}

function ScoreRing({ score }: { score: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  const filled = (score / 100) * c
  const tone = scoreTone(score)
  return (
    <div className="relative flex size-36 items-center justify-center">
      <svg viewBox="0 0 120 120" className="size-36 -rotate-90" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          className="stroke-muted"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          className={
            score >= 70
              ? "stroke-primary"
              : score >= 40
                ? "stroke-chart-4"
                : "stroke-destructive"
          }
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="tabular text-3xl font-semibold">{score}</span>
        <span className={`text-xs font-medium ${tone.className}`}>
          {tone.label}
        </span>
      </div>
    </div>
  )
}

function StarterShareBar({ node }: { node: HealthNode }) {
  const pct = Math.round(node.starterShare * 100)
  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${pct}% starter-pack volume`}
    >
      <div
        className={node.flagged ? "bg-destructive" : "bg-primary"}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function FlaggedRow({ node }: { node: HealthNode }) {
  const pct = Math.round(node.starterShare * 100)
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <span className="text-sm font-medium">{node.name}</span>
          <span className="font-mono text-xs text-muted-foreground">
            #{node.id}
          </span>
          <span className="text-xs text-muted-foreground">
            Level {node.depth} · {node.rank}
          </span>
        </div>
        <span className="tabular text-sm font-semibold text-destructive">
          {pct}% starter
        </span>
      </div>
      <StarterShareBar node={node} />
      <p className="text-xs text-muted-foreground">
        {formatVolume(node.subtreeStarter)} starter vs{" "}
        {formatVolume(node.subtreeRetail)} retail volume in this branch
      </p>
    </li>
  )
}

export function NetworkHealthView() {
  const { actingAs } = useActingAs()
  const { data, isLoading, error } = useSWR<NetworkHealth>(
    `/api/distributors/${actingAs}/health`,
    fetcher,
    { refreshInterval: 5000 },
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading network health</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <p className="py-24 text-center text-sm text-muted-foreground">
        Could not load network health. Try refreshing.
      </p>
    )
  }

  const total = data.totalRetail + data.totalStarter
  const retailPct = total > 0 ? Math.round((data.totalRetail / total) * 100) : 100

  return (
    <section aria-label="Network health" className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Network Health</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Measures how much of your network&apos;s volume comes from genuine
          retail sales versus starter packs for period {data.period}.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-6 shadow-sm">
          <ScoreRing score={data.score} />
          <p className="text-center text-xs text-muted-foreground text-pretty">
            Share of network volume from retail sales
          </p>
        </div>

        <div className="flex flex-col justify-center gap-4 rounded-lg border border-border bg-card p-6 shadow-sm lg:col-span-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Retail volume</span>
              <span className="tabular">
                {formatVolume(data.totalRetail)} ({retailPct}%)
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Starter-pack volume</span>
              <span className="tabular">
                {formatVolume(data.totalStarter)} ({100 - retailPct}%)
              </span>
            </div>
          </div>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${retailPct}% retail, ${100 - retailPct}% starter-pack volume`}
          >
            <div className="bg-primary" style={{ width: `${retailPct}%` }} />
            <div
              className="bg-destructive/70"
              style={{ width: `${100 - retailPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-pretty">
            A healthy network earns most of its volume from products sold to
            real customers. Branches where starter packs dominate may indicate
            inventory loading.
          </p>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Flagged branches</h2>
          <span className="tabular text-xs text-muted-foreground">
            {data.flagged.length} of {data.nodes.length} members
          </span>
        </header>
        {data.flagged.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium">No flagged branches</p>
            <p className="text-xs text-muted-foreground text-pretty">
              No branch in your network has more than 70% starter-pack volume
              this period.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.flagged.map((node) => (
              <FlaggedRow key={node.id} node={node} />
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
