import { NextResponse } from "next/server"
import { getNetworkHealth } from "@/lib/server/health"
import { badRequest, isValidDistId, serverError } from "@/lib/server/validate"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const health = await getNetworkHealth(id)
    return NextResponse.json(health)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown distributor")) {
      return badRequest(error.message)
    }
    return serverError(error)
  }
}
