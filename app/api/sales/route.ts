import { NextResponse } from "next/server"
import { recordSale } from "@/lib/server/repository"
import { badRequest, isValidDistId, serverError } from "@/lib/server/validate"
import type { SaleType } from "@/lib/types"

const PRODUCT_ID_RE = /^[A-Z0-9-]{2,32}$/

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequest("Request body must be valid JSON")
  }

  const { distributorId, productId, amount, volume, type } = (body ?? {}) as {
    distributorId?: unknown
    productId?: unknown
    amount?: unknown
    volume?: unknown
    type?: unknown
  }

  if (typeof distributorId !== "string" || !isValidDistId(distributorId)) {
    return badRequest("distributorId must be a valid distributor id")
  }
  if (typeof productId !== "string" || !PRODUCT_ID_RE.test(productId)) {
    return badRequest("productId is required")
  }
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 100_000
  ) {
    return badRequest("amount must be a positive number")
  }
  if (
    typeof volume !== "number" ||
    !Number.isFinite(volume) ||
    volume <= 0 ||
    volume > 100_000
  ) {
    return badRequest("volume must be a positive number")
  }
  if (type !== "retail" && type !== "starter") {
    return badRequest('type must be "retail" or "starter"')
  }

  try {
    const result = await recordSale({
      distributorId,
      productId,
      amount,
      volume,
      type: type as SaleType,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown distributor")) {
      return badRequest(error.message)
    }
    return serverError(error)
  }
}
