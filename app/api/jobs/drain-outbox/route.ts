import { NextResponse } from "next/server"
import { drainOutbox } from "@/lib/server/engine"

export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  const xToken = req.headers.get("x-seed-token")
  const secret = process.env.CRON_SECRET
  if (!secret || (auth !== `Bearer ${secret}` && xToken !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const drained = await drainOutbox(100)
  return NextResponse.json({ drained })
}
