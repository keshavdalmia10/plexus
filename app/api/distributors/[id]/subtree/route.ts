import { NextResponse } from "next/server"
import { getDistributor, getSubtree, getVolumes } from "@/lib/server/repository"
import { badRequest, isValidDistId, notFound, serverError } from "@/lib/server/validate"
import { currentPeriod } from "@/lib/types"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const root = await getDistributor(id)
    if (!root) return notFound("Distributor not found")
    const members = await getSubtree(root.path)
    members.sort((a, b) => a.path.localeCompare(b.path))
    const period = currentPeriod()
    const volumes = await getVolumes(
      members.map((m) => m.id),
      period,
    )
    return NextResponse.json({
      root,
      period,
      members: members.map((m) => {
        const v = volumes.get(m.id)
        return { ...m, pv: v?.pv ?? 0, gv: v?.gv ?? 0 }
      }),
    })
  } catch (error) {
    return serverError(error)
  }
}
