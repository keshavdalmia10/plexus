"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, Hexagon } from "lucide-react"
import { useActingAs } from "./acting-as"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/network", label: "Network" },
  { href: "/health", label: "Network Health" },
]

export function TopBar() {
  const pathname = usePathname()
  const { actingAs, setActingAs, distributors, isLoading } = useActingAs()
  const current = distributors.find((d) => d.id === actingAs)

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
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

        <div className="ml-auto flex items-center gap-2">
          <label
            htmlFor="acting-as"
            className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Acting as
          </label>
          <div className="relative">
            <select
              id="acting-as"
              value={actingAs}
              onChange={(e) => setActingAs(e.target.value)}
              disabled={isLoading}
              className="h-8 appearance-none rounded-md border border-border bg-card py-0 pl-2.5 pr-8 text-[13px] font-medium text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
            >
              {isLoading && <option>Loading…</option>}
              {distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
          {current && (
            <span className="hidden rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground md:inline">
              {current.rank}
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
