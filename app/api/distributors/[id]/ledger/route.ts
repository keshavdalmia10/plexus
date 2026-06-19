import { NextResponse } from "next/server"
import { getLedgerFeed, getStatement } from "@/lib/server/ledger"
import { badRequest, isValidDistId, serverError } from "@/lib/server/validate"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidDistId(id)) return badRequest("Invalid distributor id")
  const url = new URL(req.url)
  const statement = url.searchParams.get("statement")
  if (statement !== null) {
    if (!/^\d{4}-\d{2}$/.test(statement)) {
      return badRequest("statement must be YYYY-MM")
    }
    try {
      const data = await getStatement(id, statement)
      return NextResponse.json(data)
    } catch (error) {
      return serverError(error)
    }
  }
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 25
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    return badRequest("limit must be between 1 and 100")
  }
  try {
    const entries = await getLedgerFeed(id, limit)
    return NextResponse.json({ entries })
  } catch (error) {
    return serverError(error)
  }
}
