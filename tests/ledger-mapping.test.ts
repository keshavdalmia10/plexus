import { describe, expect, it } from "vitest"
import { toLedgerEntry } from "@/lib/server/ledger"

describe("toLedgerEntry", () => {
  it("maps a DSQL row to the LedgerEntry shape with numeric amount", () => {
    expect(
      toLedgerEntry({
        txn_id: "t1", sale_id: "s1", beneficiary_id: "014", source_id: "207",
        source_name: "Ravi Shah", level: 1, amount: "20.00", period: "2026-06",
        created_at: new Date("2026-06-12T00:00:00Z"),
      }),
    ).toEqual({
      txnId: "t1", beneficiaryId: "014", sourceDistId: "207",
      sourceName: "Ravi Shah", level: 1, amount: 20, period: "2026-06",
      timestamp: "2026-06-12T00:00:00.000Z",
    })
  })
})
