import { NextResponse } from "next/server"
import { z } from "zod"

export const DIST_ID_RE = /^\d{3}$/

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function serverError(error: unknown) {
  console.error("[api] error:", error)
  return NextResponse.json({ error: "Internal server error" }, { status: 500 })
}

export function isValidDistId(id: string): boolean {
  return DIST_ID_RE.test(id)
}

export const distId = z.string().regex(/^\d{3}$/)

export const saleBody = z.object({
  distributorId: distId,
  productId: z.string().regex(/^[A-Z0-9-]{2,32}$/),
  amount: z.number().positive().max(100_000),
  volume: z.number().positive().max(100_000),
  type: z.enum(["retail", "starter"]),
  saleId: z.string().uuid().optional(),
})

export const upgradeBody = z.object({ distributorId: distId })
