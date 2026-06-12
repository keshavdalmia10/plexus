const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const num = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

export function formatMoney(n: number): string {
  return usd.format(n)
}

export function formatVolume(n: number): string {
  return num.format(Math.round(n))
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
