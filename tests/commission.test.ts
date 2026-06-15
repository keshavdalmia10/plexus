import { describe, expect, it } from "vitest"
import {
  ancestorsOf,
  computeCommissions,
  deterministicTxnId,
} from "@/lib/commission"

describe("ancestorsOf", () => {
  it("returns ancestors nearest-first, excluding self", () => {
    expect(ancestorsOf("001/014/207")).toEqual(["014", "001"])
  })
  it("returns [] for a root", () => {
    expect(ancestorsOf("001")).toEqual([])
  })
})

describe("computeCommissions", () => {
  it("pays volume-based rates 10/5/3/2/1 to nearest 5 ancestors", () => {
    const out = computeCommissions({
      saleId: "s1",
      sellerPath: "a/b/c/d/e/f/g", // 6 ancestors, only 5 paid
      volume: 200,
    })
    expect(out.map((c) => [c.beneficiaryId, c.level, c.amount])).toEqual([
      ["f", 1, 20],
      ["e", 2, 10],
      ["d", 3, 6],
      ["c", 4, 4],
      ["b", 5, 2],
    ])
  })
  it("rounds to cents", () => {
    const out = computeCommissions({ saleId: "s1", sellerPath: "a/b", volume: 33.33 })
    expect(out[0].amount).toBe(3.33)
  })
})

describe("deterministicTxnId", () => {
  it("is stable for the same (saleId, beneficiaryId)", () => {
    expect(deterministicTxnId("s1", "b1")).toBe(deterministicTxnId("s1", "b1"))
  })
  it("differs across beneficiaries", () => {
    expect(deterministicTxnId("s1", "b1")).not.toBe(deterministicTxnId("s1", "b2"))
  })
  it("matches the known hash for a fixed input (idempotency regression guard)", () => {
    expect(deterministicTxnId("s1", "b1")).toBe("a4daeab030988e56677213dcebff7778")
  })
})
