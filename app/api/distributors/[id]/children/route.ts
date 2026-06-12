import { NextResponse } from "next/server"
import { getDirectChildren } from "@/lib/server/repository"
import { badRequest, isValidDistId, serverError } from "@/lib/server/validate"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const children = await getDirectChildren(id)
    return NextResponse.json({ children })
  } catch (error) {
    return serverError(error)
  }
}
