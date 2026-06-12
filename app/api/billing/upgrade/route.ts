import { NextResponse } from "next/server"
import { setPlan } from "@/lib/server/repository"
import { badRequest, isValidDistId, notFound, serverError } from "@/lib/server/validate"

/**
 * Mock upgrade endpoint — no real payment. Flips the seller to Pro and
 * persists the plan so API-side gating lifts immediately.
 */
export async function POST(req: Request) {
  let body: { distributorId?: string }
  try {
    body = await req.json()
  } catch {
    return badRequest("Invalid JSON body")
  }
  const id = body.distributorId
  if (!id || !isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const distributor = await setPlan(id, "pro")
    if (!distributor) return notFound("Distributor not found")
    return NextResponse.json({ distributor })
  } catch (error) {
    return serverError(error)
  }
}
