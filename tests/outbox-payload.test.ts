import { describe, expect, it } from "vitest"
import { buildOutboxPayload } from "@/lib/server/engine"
import { computeCommissions } from "@/lib/commission"
import { currentPeriod } from "@/lib/types"
import type { Sale } from "@/lib/types"

describe("buildOutboxPayload", () => {
  const sale: Sale = {
    saleId: "test-sale-1",
    distributorId: "038",
    productId: "PLX-VITA",
    amount: 100,
    volume: 100,
    type: "retail",
    timestamp: "2026-06-01T00:00:00.000Z",
  }
  const sellerPath = "001/002/006/016/027/033/037/038"
  const period = "2026-06"
  const commissions = computeCommissions({
    saleId: sale.saleId,
    sellerPath,
    volume: sale.volume,
  })

  it("returns a payload with the expected shape", () => {
    const payload = buildOutboxPayload(sale, sellerPath, commissions, period)
    expect(payload.saleId).toBe(sale.saleId)
    expect(payload.sellerId).toBe(sale.distributorId)
    expect(payload.sellerPath).toBe(sellerPath)
    expect(payload.period).toBe(period)
    expect(payload.volume).toBe(sale.volume)
    expect(payload.saleType).toBe(sale.type)
  })

  it("includes beneficiaries with id and amount from commission lines", () => {
    const payload = buildOutboxPayload(sale, sellerPath, commissions, period)
    expect(Array.isArray(payload.beneficiaries)).toBe(true)
    expect(payload.beneficiaries.length).toBe(commissions.length)
    for (let i = 0; i < commissions.length; i++) {
      expect(payload.beneficiaries[i].id).toBe(commissions[i].beneficiaryId)
      expect(payload.beneficiaries[i].amount).toBe(commissions[i].amount)
    }
  })

  it("beneficiaries have correct commission amounts (10/5/3/2/1 % of volume=100)", () => {
    const payload = buildOutboxPayload(sale, sellerPath, commissions, period)
    // Nearest 5 ancestors: 037(L1)=10, 033(L2)=5, 027(L3)=3, 016(L4)=2, 006(L5)=1
    const amounts = payload.beneficiaries.map((b: { id: string; amount: number }) => b.amount)
    expect(amounts).toEqual([10, 5, 3, 2, 1])
  })

  it("payload contains everything needed to apply aggregates without a DB read", () => {
    const payload = buildOutboxPayload(sale, sellerPath, commissions, period)
    // sellerPath gives ancestors for gv
    expect(payload.sellerPath).toBeTruthy()
    // volume + saleType give the seller's pv/gv/split
    expect(payload.volume).toBeGreaterThan(0)
    expect(payload.saleType).toMatch(/^(retail|starter)$/)
    // beneficiaries give commissionEarned
    expect(payload.beneficiaries.every((b: { id: string; amount: number }) => b.id && b.amount >= 0)).toBe(true)
  })

  it("works for a starter sale", () => {
    const starterSale: Sale = { ...sale, type: "starter" }
    const payload = buildOutboxPayload(starterSale, sellerPath, commissions, period)
    expect(payload.saleType).toBe("starter")
  })

  it("works for a seller with no ancestors (root)", () => {
    const rootSale: Sale = { ...sale, distributorId: "001" }
    const noCommissions = computeCommissions({
      saleId: rootSale.saleId,
      sellerPath: "001",
      volume: rootSale.volume,
    })
    const payload = buildOutboxPayload(rootSale, "001", noCommissions, period)
    expect(payload.beneficiaries).toEqual([])
  })
})
