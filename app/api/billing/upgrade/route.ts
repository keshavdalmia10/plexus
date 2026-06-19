import { NextResponse } from "next/server"
import { setPlan } from "@/lib/server/repository"
import { badRequest, notFound, serverError, upgradeBody } from "@/lib/server/validate"

/**
 * Mock upgrade endpoint — no real payment. Flips the seller to Pro and
 * persists the plan so API-side gating lifts immediately.
 */
export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequest("Request body must be valid JSON")
  }

  const parsed = upgradeBody.safeParse(body)
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message)
  }

  try {
    const distributor = await setPlan(parsed.data.distributorId, "pro")
    if (!distributor) return notFound("Distributor not found")
    return NextResponse.json({ distributor })
  } catch (error) {
    return serverError(error)
  }
}
