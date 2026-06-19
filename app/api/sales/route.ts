import { NextResponse } from "next/server"
import { recordSale } from "@/lib/server/engine"
import { badRequest, serverError, saleBody } from "@/lib/server/validate"

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequest("Request body must be valid JSON")
  }

  const parsed = saleBody.safeParse(body)
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0].message)
  }

  try {
    const result = await recordSale(parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown distributor")) {
      return badRequest(error.message)
    }
    return serverError(error)
  }
}
