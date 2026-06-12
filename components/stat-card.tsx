"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string
  /** Raw numeric value used to detect live updates */
  raw?: number
  sublabel?: string
  mono?: boolean
}

export function StatCard({
  label,
  value,
  raw,
  sublabel,
  mono = true,
}: StatCardProps) {
  const prev = useRef<number | undefined>(undefined)
  const [flash, setFlash] = useState(0)

  useEffect(() => {
    if (
      raw !== undefined &&
      prev.current !== undefined &&
      raw !== prev.current
    ) {
      setFlash((f) => f + 1)
    }
    prev.current = raw
  }, [raw])

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-sm">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        key={flash}
        className={cn(
          "tabular w-fit text-xl font-semibold leading-tight",
          mono && "font-mono",
          flash > 0 && "value-flash",
        )}
      >
        {value}
      </span>
      {sublabel && (
        <span className="text-xs text-muted-foreground">{sublabel}</span>
      )}
    </div>
  )
}
