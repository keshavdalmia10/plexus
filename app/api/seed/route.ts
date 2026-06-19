import { NextResponse } from "next/server"
import { reseed } from "@/lib/server/seed"
import { serverError } from "@/lib/server/validate"

export async function POST(req: Request) {
  const token = req.headers.get("x-seed-token")
  if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const counts = await reseed()
    return NextResponse.json(counts)
  } catch (error) {
    return serverError(error)
  }
}
