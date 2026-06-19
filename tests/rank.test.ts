import { describe, expect, it } from "vitest"
import { rankForVolume, type RankThreshold } from "@/lib/types"

const STANDARD: RankThreshold[] = [
  { rankName: "Associate", minGv: 0, minPv: 0, order: 0 },
  { rankName: "Builder", minGv: 500, minPv: 100, order: 1 },
  { rankName: "Director", minGv: 2000, minPv: 200, order: 2 },
  { rankName: "Executive", minGv: 5000, minPv: 300, order: 3 },
  { rankName: "Diamond", minGv: 12000, minPv: 400, order: 4 },
]

describe("rankForVolume", () => {
  it("returns Associate for zero volume", () => {
    expect(rankForVolume(0, 0, STANDARD)).toBe("Associate")
  })

  it("returns Director for mid-tier volume", () => {
    expect(rankForVolume(2500, 250, STANDARD)).toBe("Director")
  })

  it("returns Diamond for top-tier volume", () => {
    expect(rankForVolume(20000, 500, STANDARD)).toBe("Diamond")
  })

  it("requires BOTH gv and pv minima to be met", () => {
    // gv qualifies for Director but pv only qualifies for Builder
    expect(rankForVolume(2500, 150, STANDARD)).toBe("Builder")
  })

  it("works with an out-of-order ranks array", () => {
    const shuffled: RankThreshold[] = [
      { rankName: "Diamond", minGv: 12000, minPv: 400, order: 4 },
      { rankName: "Associate", minGv: 0, minPv: 0, order: 0 },
      { rankName: "Executive", minGv: 5000, minPv: 300, order: 3 },
      { rankName: "Builder", minGv: 500, minPv: 100, order: 1 },
      { rankName: "Director", minGv: 2000, minPv: 200, order: 2 },
    ]
    expect(rankForVolume(2500, 250, shuffled)).toBe("Director")
    expect(rankForVolume(20000, 500, shuffled)).toBe("Diamond")
    expect(rankForVolume(0, 0, shuffled)).toBe("Associate")
  })
})
