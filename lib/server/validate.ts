import { NextResponse } from "next/server"

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
