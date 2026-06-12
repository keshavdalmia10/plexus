import type { Metadata } from "next"
import { NetworkTree } from "@/components/network-tree"

export const metadata: Metadata = {
  title: "Network — Plexus",
}

export default function NetworkPage() {
  return <NetworkTree />
}
