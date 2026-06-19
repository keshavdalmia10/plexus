import { NextResponse } from "next/server"
import {
  getConfig,
  getDistributor,
  getVolume,
} from "@/lib/server/repository"
import { badRequest, isValidDistId, notFound, serverError } from "@/lib/server/validate"
import { currentPeriod, previousPeriod, rankForVolume } from "@/lib/types"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const distributor = await getDistributor(id)
    if (!distributor) return notFound("Distributor not found")
    const [volume, previousVolume, config] = await Promise.all([
      getVolume(id, currentPeriod()),
      getVolume(id, previousPeriod()),
      getConfig(),
    ])
    const rank = rankForVolume(volume.gv, volume.pv, config.ranks)
    return NextResponse.json({ distributor: { ...distributor, rank }, volume, previousVolume })
  } catch (error) {
    return serverError(error)
  }
}
