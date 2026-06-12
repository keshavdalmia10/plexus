import { NextResponse } from "next/server"
import { getDistributor, getSubtree, getVolumes } from "@/lib/server/repository"
import { badRequest, isValidDistId, notFound, serverError } from "@/lib/server/validate"
import { currentPeriod, FREE_NETWORK_DEPTH, type LockedLevels } from "@/lib/types"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const root = await getDistributor(id)
    if (!root) return notFound("Distributor not found")
    const all = await getSubtree(root.path)
    all.sort((a, b) => a.path.localeCompare(b.path))

    // Plan gating, enforced server-side: Free sellers only receive members
    // within FREE_NETWORK_DEPTH relative levels. Deeper rows never leave
    // the API — only an anonymous count of what is hidden.
    let members = all
    let locked: LockedLevels | null = null
    if (root.plan === "free") {
      members = all.filter((m) => m.depth - root.depth <= FREE_NETWORK_DEPTH)
      const hidden = all.filter(
        (m) => m.depth - root.depth > FREE_NETWORK_DEPTH,
      )
      if (hidden.length > 0) {
        locked = {
          memberCount: hidden.length,
          levels: [...new Set(hidden.map((m) => m.depth - root.depth))].sort(
            (a, b) => a - b,
          ),
        }
      }
    }

    const period = currentPeriod()
    const volumes = await getVolumes(
      members.map((m) => m.id),
      period,
    )
    return NextResponse.json({
      root,
      period,
      locked,
      members: members.map((m) => {
        const v = volumes.get(m.id)
        return { ...m, pv: v?.pv ?? 0, gv: v?.gv ?? 0 }
      }),
    })
  } catch (error) {
    return serverError(error)
  }
}
