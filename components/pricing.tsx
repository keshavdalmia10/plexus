"use client"

import { Check, Loader2, Sparkles } from "lucide-react"
import { useActingAs } from "./acting-as"
import { useUpgrade } from "./use-upgrade"

const FREE_FEATURES = [
  "Live earnings dashboard",
  "Record sales",
  "Commission feed",
  "Network view, levels 1\u20133",
]

const PRO_FEATURES = [
  "Everything in Free",
  "Your full network, all levels",
  "Network Health analytics",
]

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  )
}

export function Pricing() {
  const { current } = useActingAs()
  const { upgrade, isUpgrading, error } = useUpgrade()
  const isPro = current?.plan === "pro"

  return (
    <section aria-label="Pricing" className="flex flex-col gap-8 py-6">
      <header className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Get the full picture of your business
        </h1>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          Start free. Upgrade when you want to see your whole network and how
          healthy it really is.
        </p>
      </header>

      <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        {/* Free */}
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm">
          <div>
            <h2 className="text-sm font-semibold">Free</h2>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="tabular text-3xl font-semibold">$0</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Everything you need to run your side hustle day to day.
            </p>
          </div>
          <FeatureList features={FREE_FEATURES} />
          <div className="mt-auto">
            <span className="inline-flex h-9 w-full items-center justify-center rounded-md border border-border text-sm font-medium text-muted-foreground">
              {isPro ? "Included in Pro" : "Your current plan"}
            </span>
          </div>
        </div>

        {/* Pro */}
        <div className="relative flex flex-col gap-5 rounded-lg border-2 border-primary bg-card p-6 shadow-sm">
          <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
            <Sparkles className="size-3" aria-hidden />
            Pro
          </span>
          <div>
            <h2 className="text-sm font-semibold">Pro</h2>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="tabular text-3xl font-semibold">$12</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              For sellers growing a real team underneath them.
            </p>
          </div>
          <FeatureList features={PRO_FEATURES} />
          <div className="mt-auto flex flex-col gap-2">
            {isPro ? (
              <span className="inline-flex h-9 w-full items-center justify-center rounded-md bg-secondary text-sm font-medium text-secondary-foreground">
                You&apos;re on Pro
              </span>
            ) : (
              <button
                type="button"
                onClick={upgrade}
                disabled={isUpgrading}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isUpgrading && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                Upgrade to Pro
              </button>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            {!isPro && (
              <p className="text-center text-[11px] text-muted-foreground">
                Demo checkout &mdash; no payment is collected.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
