import { NextResponse } from "next/server"
import { ensureSeeded } from "@/lib/server/seed"
import { getAllDistributors } from "@/lib/server/repository"
import { serverError } from "@/lib/server/validate"

export async function GET() {
  try {
    await ensureSeeded()
    const distributors = await getAllDistributors()
    distributors.sort((a, b) => a.id.localeCompare(b.id))
    return NextResponse.json({ distributors })
  } catch (error) {
    return serverError(error)
  }
}
