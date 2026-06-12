"use client"

import { useState } from "react"
import { Plus, X } from "lucide-react"
import { useSWRConfig } from "swr"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/format"
import type { SaleType } from "@/lib/types"
import { cn } from "@/lib/utils"

const CATALOG: {
  id: string
  name: string
  amount: number
  volume: number
  type: SaleType
}[] = [
  { id: "PLX-VITA", name: "Daily Vitality", amount: 64, volume: 50, type: "retail" },
  { id: "PLX-OMEGA", name: "Omega Complex", amount: 89, volume: 70, type: "retail" },
  { id: "PLX-GREENS", name: "Field Greens", amount: 49, volume: 40, type: "retail" },
  { id: "PLX-PROTEIN", name: "Lean Protein", amount: 119, volume: 95, type: "retail" },
  { id: "PLX-SLEEP", name: "Rest Formula", amount: 54, volume: 42, type: "retail" },
  { id: "PLX-BUNDLE", name: "Wellness Bundle", amount: 179, volume: 140, type: "retail" },
  { id: "PLX-KIT-BASIC", name: "Starter Kit — Basic", amount: 299, volume: 200, type: "starter" },
  { id: "PLX-KIT-PRO", name: "Starter Kit — Pro", amount: 499, volume: 400, type: "starter" },
]

export function RecordSale({ distributorId }: { distributorId: string }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(CATALOG[0].id)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { mutate } = useSWRConfig()

  const product = CATALOG.find((p) => p.id === selected) ?? CATALOG[0]

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributorId,
          productId: product.id,
          amount: product.amount,
          volume: product.volume,
          type: product.type,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "Failed to record sale")
      }
      // Refresh dashboard data immediately; pollers pick up upline changes.
      await Promise.all([
        mutate(`/api/distributors/${distributorId}`),
        mutate(`/api/distributors/${distributorId}/ledger?limit=25`),
      ])
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record sale")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus className="size-4" aria-hidden />
        Record a sale
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-sale-title"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="record-sale-title" className="text-sm font-semibold">
                Record a sale
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" aria-hidden />
                <span className="sr-only">Close</span>
              </button>
            </div>

            <div className="flex flex-col gap-2 p-4">
              <p className="text-xs text-muted-foreground">
                Posting as distributor #{distributorId}. Commissions pay 5
                levels up at 10/5/3/2/1%.
              </p>
              <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Product">
                {CATALOG.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected === p.id}
                      onClick={() => setSelected(p.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        selected === p.id
                          ? "border-primary bg-accent"
                          : "border-border hover:bg-secondary",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium">{p.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {p.id} · {p.volume} PV
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          p.type === "retail"
                            ? "bg-accent text-accent-foreground"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {p.type}
                      </span>
                      <span className="tabular font-mono text-[13px] font-semibold">
                        {formatMoney(p.amount)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {error && (
                <p className="text-xs font-medium text-destructive">{error}</p>
              )}

              <div className="mt-1 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={submit} disabled={submitting}>
                  {submitting ? "Posting…" : `Post ${formatMoney(product.amount)} sale`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
