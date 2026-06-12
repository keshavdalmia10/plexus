"use client"

import { useCallback, useState } from "react"
import { useSWRConfig } from "swr"
import { useActingAs } from "./acting-as"

/**
 * Mock upgrade flow. Flips the current seller to Pro, then revalidates every
 * distributor-scoped SWR key so gated screens unlock without a reload.
 */
export function useUpgrade() {
  const { actingAs, refresh } = useActingAs()
  const { mutate } = useSWRConfig()
  const [isUpgrading, setIsUpgrading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upgrade = useCallback(async () => {
    setIsUpgrading(true)
    setError(null)
    try {
      const res = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distributorId: actingAs }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Upgrade failed")
      }
      await Promise.all([
        refresh(),
        mutate(
          (key) =>
            typeof key === "string" && key.startsWith("/api/distributors"),
        ),
      ])
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upgrade failed")
      return false
    } finally {
      setIsUpgrading(false)
    }
  }, [actingAs, refresh, mutate])

  return { upgrade, isUpgrading, error }
}
