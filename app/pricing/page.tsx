import type { Metadata } from "next"
import { Pricing } from "@/components/pricing"

export const metadata: Metadata = {
  title: "Pricing — Plexus",
  description: "Free vs Pro: unlock your full network and health analytics.",
}

export default function PricingPage() {
  return <Pricing />
}
