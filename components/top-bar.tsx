"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, Hexagon, Sparkles } from "lucide-react"
import { useActingAs } from "./acting-as"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/network", label: "Network" },
  { href: "/health", label: "Health" },
  { href: "/pricing", label: "Pricing" },
]

function PlanBadge({ plan }: { plan: "free" | "pro" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        plan === "pro"
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {plan === "pro" && <Sparkles className="size-3" aria-hidden />}
      {plan === "pro" ? "Pro" : "Free"}
    </span>
  )
}

export function TopBar() {
  const pathname = usePathname()
  const { actingAs, setActingAs, distributors, isLoading, current } =
    useActingAs()

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 sm:gap-6">
        <Link href="/" className="flex items-center gap-2">
          <Hexagon className="size-4 text-primary" strokeWidth={2.5} aria-hidden />
          <span className="text-sm font-semibold tracking-tight">Plexus</span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                pathname === item.href
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          {current && <PlanBadge plan={current.plan} />}
          {current?.plan === "free" && (
            <Link
              href="/pricing"
              className="hidden h-7 items-center rounded-md bg-primary px-2.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:inline-flex"
            >
              Upgrade
            </Link>
          )}

          {/* Demo-only control: switch which seller you are viewing as */}
          <div className="relative hidden md:block">
            <label htmlFor="acting-as" className="sr-only">
              Demo: view as seller
            </label>
            <select
              id="acting-as"
              value={actingAs}
              onChange={(e) => setActingAs(e.target.value)}
              disabled={isLoading}
              title="Demo control: view the app as a different seller"
              className="h-7 max-w-36 appearance-none truncate rounded-md border border-dashed border-border bg-transparent py-0 pl-2 pr-6 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
            >
              {isLoading && (
                <option value={actingAs} disabled>
                  Loading…
                </option>
              )}
              {distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  Demo: {d.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
      </div>
    </header>
  )
}
