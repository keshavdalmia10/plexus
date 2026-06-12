"use client"

import Link from "next/link"
import { Loader2, Lock } from "lucide-react"
import { useUpgrade } from "./use-upgrade"
import type { ReactNode } from "react"

/**
 * SaaS-style paywall: renders blurred placeholder content behind a quiet
 * upgrade prompt. The blurred children are decorative only — real data is
 * withheld by the API for Free sellers.
 */
export function Paywall({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const { upgrade, isUpgrading, error } = useUpgrade()

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="pointer-events-none select-none blur-[6px]" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/55 p-4">
        <div className="flex w-full max-w-xs flex-col items-center gap-3 rounded-lg border border-border bg-card p-5 text-center shadow-md">
          <span className="flex size-9 items-center justify-center rounded-full bg-secondary">
            <Lock className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground text-pretty">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={upgrade}
            disabled={isUpgrading}
            className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {isUpgrading && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            )}
            Upgrade to Pro
          </button>
          <Link
            href="/pricing"
            className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Compare plans
          </Link>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}

/** Decorative skeleton rows rendered behind the paywall blur. */
export function PaywallSkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
          style={{ marginLeft: `${(i % 3) * 20}px` }}
        >
          <span className="size-6 rounded-md bg-muted" />
          <span className="h-3 w-32 rounded bg-muted" />
          <span className="ml-auto h-3 w-12 rounded bg-muted" />
          <span className="h-3 w-12 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
