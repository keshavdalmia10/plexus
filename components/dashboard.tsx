"use client"

import { useEffect } from "react"
import useSWR, { useSWRConfig } from "swr"
import { fetcher, useActingAs } from "./acting-as"
import { LedgerFeed } from "./ledger-feed"
import { RecordSale } from "./record-sale"
import { StatCard } from "./stat-card"
import { formatMoney, formatVolume } from "@/lib/format"
import type {
  Distributor,
  LedgerEntry,
  VolumeAggregate,
} from "@/lib/types"

const POLL = { refreshInterval: 2000, revalidateOnFocus: true }

interface SummaryResponse {
  distributor: Distributor
  volume: VolumeAggregate
  previousVolume: VolumeAggregate
}

export function Dashboard() {
  const { actingAs } = useActingAs()
  const { mutate } = useSWRConfig()

  const { data: summary } = useSWR<SummaryResponse>(
    `/api/distributors/${actingAs}`,
    fetcher,
    POLL,
  )
  const { data: ledger } = useSWR<{ entries: LedgerEntry[] }>(
    `/api/distributors/${actingAs}/ledger?limit=25`,
    fetcher,
    POLL,
  )

  useEffect(() => {
    if (!actingAs) return
    const es = new EventSource(`/api/stream/${actingAs}`)
    es.onmessage = () => {
      mutate(`/api/distributors/${actingAs}`)
      mutate(`/api/distributors/${actingAs}/ledger?limit=25`)
    }
    es.onerror = () => { es.close() } // SWR polling remains the fallback
    return () => es.close()
  }, [actingAs, mutate])

  const d = summary?.distributor
  const v = summary?.volume
  const pv = summary?.previousVolume

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Your dashboard
          </p>
          <h1 className="text-lg font-semibold tracking-tight">
            {d ? d.name : "Loading…"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {d
              ? `${d.rank} · this month, updating live`
              : "Fetching your account"}
          </p>
        </div>
        <RecordSale distributorId={actingAs} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Your sales volume"
          value={v ? formatVolume(v.pv) : "—"}
          raw={v?.pv}
          sublabel={pv ? `${formatVolume(pv.pv)} last month` : undefined}
        />
        <StatCard
          label="Your network volume"
          value={v ? formatVolume(v.gv) : "—"}
          raw={v?.gv}
          sublabel={pv ? `${formatVolume(pv.gv)} last month` : undefined}
        />
        <StatCard
          label="Your rank"
          value={d?.rank ?? "—"}
          mono={false}
          sublabel={d ? `Since joining` : undefined}
        />
        <StatCard
          label="Your earnings"
          value={v ? formatMoney(v.commissionEarned) : "—"}
          raw={v?.commissionEarned}
          sublabel={
            pv ? `${formatMoney(pv.commissionEarned)} last month` : undefined
          }
        />
      </div>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Your commission feed</h2>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Live
          </span>
        </header>
        <LedgerFeed entries={ledger?.entries ?? []} />
      </section>
    </div>
  )
}
