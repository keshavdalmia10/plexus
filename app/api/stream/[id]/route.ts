import { getVolume } from "@/lib/server/repository"
import { currentPeriod } from "@/lib/types"
import { isValidDistId } from "@/lib/server/validate"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isValidDistId(id)) return new Response("invalid id", { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let lastSig = ""
      let closed = false
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }
      const tick = async () => {
        try {
          const v = await getVolume(id, currentPeriod())
          const sig = `${v.gv}|${v.pv}|${v.commissionEarned}`
          if (sig !== lastSig) {
            lastSig = sig
            send({ type: "volume", gv: v.gv, pv: v.pv, commissionEarned: v.commissionEarned, period: currentPeriod() })
          }
        } catch {
          // swallow; try again next tick
        }
      }
      await tick() // initial push
      const poll = setInterval(tick, 2000)
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`))
      }, 15000)
      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(poll)
        clearInterval(heartbeat)
        try { controller.close() } catch {}
      }
      req.signal.addEventListener("abort", cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
