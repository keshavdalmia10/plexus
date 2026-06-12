"use client"

import { useEffect, useRef, useState } from "react"
import { formatMoney, formatTime } from "@/lib/format"
import type { LedgerEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

export function LedgerFeed({ entries }: { entries: LedgerEntry[] }) {
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (known.current === null) {
      known.current = new Set(entries.map((e) => e.txnId))
      return
    }
    const incoming = entries.filter((e) => !known.current?.has(e.txnId))
    if (incoming.length > 0) {
      for (const e of incoming) known.current.add(e.txnId)
      setFresh(new Set(incoming.map((e) => e.txnId)))
    }
  }, [entries])

  if (entries.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No commissions yet. They appear here as downline sales happen.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border">
      {entries.map((e) => (
        <li
          key={e.txnId}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5",
            fresh.has(e.txnId) && "feed-in",
          )}
        >
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-[10px] font-semibold text-accent-foreground"
            title={`Level ${e.level} commission`}
          >
            L{e.level}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">
              {e.sourceName ?? e.sourceDistId}
              <span className="text-muted-foreground"> · sale commission</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatTime(e.timestamp)} · level {e.level} · from #{e.sourceDistId}
            </p>
          </div>
          <span className="tabular font-mono text-[13px] font-semibold text-primary">
            +{formatMoney(e.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}
