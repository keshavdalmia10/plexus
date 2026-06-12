import { NextResponse } from "next/server"
import { getDistributor, getSubtree } from "@/lib/server/repository"
import { badRequest, isValidDistId, notFound, serverError } from "@/lib/server/validate"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  try {
    const root = await getDistributor(id)
    if (!root) return notFound("Distributor not found")
    const members = await getSubtree(root.path)
    members.sort((a, b) => a.path.localeCompare(b.path))
    return NextResponse.json({ root, members })
  } catch (error) {
    return serverError(error)
  }
}
