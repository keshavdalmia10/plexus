import { NextResponse } from "next/server"
import { getNetworkHealth } from "@/lib/server/health"
import { getDistributor, getHealthRollup, getSubtree } from "@/lib/server/repository"
import { badRequest, isValidDistId, notFound, serverError } from "@/lib/server/validate"
import { currentPeriod, type NetworkHealthTeaser } from "@/lib/types"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const distributor = await getDistributor(id)
    if (!distributor) return notFound("Distributor not found")

    // Network Health is a Pro feature. Free sellers get a teaser payload
    // only — the score and per-branch analytics never leave the API.
    if (distributor.plan === "free") {
      const members = await getSubtree(distributor.path)
      const teaser: NetworkHealthTeaser = {
        gated: true,
        rootId: id,
        period: currentPeriod(),
        memberCount: members.length,
      }
      return NextResponse.json(teaser)
    }

    const period = currentPeriod()
    let health = await getHealthRollup(id, period)
    let source = "rollup"
    if (!health) { health = await getNetworkHealth(id); source = "live" }
    return NextResponse.json({ ...health, source })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown distributor")) {
      return badRequest(error.message)
    }
    return serverError(error)
  }
}
