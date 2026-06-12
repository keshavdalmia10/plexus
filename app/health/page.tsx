import type { Metadata } from "next"
import { NetworkHealthView } from "@/components/network-health"

export const metadata: Metadata = {
  title: "Network Health — Plexus",
}

export default function HealthPage() {
  return <NetworkHealthView />
}
