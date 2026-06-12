import { NextResponse } from "next/server"
import {
  getDistributor,
  getVolume,
} from "@/lib/server/repository"
import { badRequest, isValidDistId, notFound, serverError } from "@/lib/server/validate"
import { currentPeriod, previousPeriod } from "@/lib/types"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const distributor = await getDistributor(id)
    if (!distributor) return notFound("Distributor not found")
    const [volume, previousVolume] = await Promise.all([
      getVolume(id, currentPeriod()),
      getVolume(id, previousPeriod()),
    ])
    return NextResponse.json({ distributor, volume, previousVolume })
  } catch (error) {
    return serverError(error)
  }
}
