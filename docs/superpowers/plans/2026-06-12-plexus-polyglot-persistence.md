# Plexus Polyglot Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing DynamoDB-only Plexus app into the spec's polyglot design — Aurora DSQL becomes the ACID system of record for sales + commission ledger, DynamoDB keeps the network graph + derived read models, connected by a synchronous write path (Phase B) upgraded to a transactional outbox with async health rollups and SSE (Phase C) — then produce the hackathon submission artifacts (Phase D).

**Architecture:** `POST /api/sales` resolves the upline from the DynamoDB materialized path (no traversal), writes the sale + all ledger rows (+ outbox row in Phase C) in ONE DSQL transaction with deterministic `txn_id`s for idempotency, then propagates atomic `ADD` updates to the DynamoDB `VOLUME#` aggregates. DSQL ledger = source of truth; DynamoDB aggregates = rebuildable derived read model. Phase C moves propagation into an outbox drainer that applies each event through a DynamoDB `TransactWriteItems` with an idempotency-marker item (exactly-once application), maintains `HEALTH#<period>` rollup items, and is triggered inline after commit + swept by a Vercel cron (Lambda/Streams attempted first, cron is the sanctioned fallback).

**Tech Stack:** Next.js 16 App Router (already deployed), TypeScript strict, `@aws-sdk/lib-dynamodb`, Aurora DSQL via `pg` + `@aws-sdk/dsql-signer` (IAM token auth over Vercel OIDC), zod, vitest, SSE via ReadableStream.

**Spec:** `docs/superpowers/specs/2026-06-12-plexus-hackathon-spec.md`. Decisions already made with the user: (1) DSQL via Vercel Marketplace AWS integration; (2) Lambda+Streams attempted, Vercel cron fallback; (3) keep TREE/PARENT materialized index items (no GSIs — integration IAM boundary blocks UpdateTable); document the deviation.

---

## Current state (verified 2026-06-12)

Working DynamoDB-only app at repo root (`keshavdalmia10/plexus`, branch `main`, deployed on Vercel as `plexus-commission-dashboard-f1`, env via `vercel env pull` → `.env.local`):

- `lib/server/dynamo.ts` — DocumentClient singleton, OIDC creds, key builders (`keys.*`). Single-table design documented in its header comment.
- `lib/server/repository.ts` — all DDB access. `recordSale()` currently writes `SALE#`/`LEDGER#` items to DynamoDB (wrong store per spec, amount-based commissions, random `nanoid` txn ids, non-atomic `Promise.all`).
- `lib/server/health.ts` — live subtree health computation (Phase-2 style).
- `lib/server/seed.ts` + `scripts/reset-data.mjs` — 40-seller tree, DDB only.
- `app/api/{sales,distributors/*,billing/upgrade}` — full read/write surface with **API-level plan gating already correct** (health teaser for Free, depth-gated subtree).
- UI complete: dashboard, network tree, health heatmap, pricing, acting-as switcher (SWR polling).
- No test runner. No DSQL anywhere. `.env.local` has only DynamoDB vars.

**What stays untouched:** gating logic, UI components (except live-update wiring in Task 14), tree/health read paths. (`dynamo.ts` gets only key-builder edits: Task 6 removes `keys.sale/ledger`, Task 9 adds `keys.configPK`, Task 11 adds `keys.eventPK`.)

## DSQL reality notes (verify against docs during Tasks 3–4, but plan for them)

Aurora DSQL is Postgres-compatible but NOT Postgres. Known constraints that change the spec's DDL:

1. **No FOREIGN KEY constraints** → drop `REFERENCES sales(sale_id)`; enforce relationship in code; note it in README (judges know this limitation — naming it is a credibility win).
2. **No sequences / SERIAL / `GENERATED ... AS IDENTITY`** → outbox PK becomes `UUID DEFAULT gen_random_uuid()`, ordering by `created_at`.
3. **`CREATE INDEX ASYNC`** — DSQL creates indexes asynchronously via a job; plain `CREATE INDEX` is rejected on populated tables. Use `CREATE INDEX ASYNC` in the migration script.
4. **DDL and DML cannot mix in one transaction; one DDL per transaction** → migration script runs statements one at a time, no wrapping `BEGIN`.
5. **Optimistic concurrency** — concurrent transactions can fail with SQLSTATE `40001`; every write goes through a small retry helper.
6. **Auth = IAM token as the Postgres password** (expires ~15 min) → `pg` Pool with `password: async () => signer.getDbConnectAdminAuthToken()`, TLS required.

## File structure

```
lib/
  commission.ts            NEW  pure: ancestors/levels/amounts/txn ids (unit-tested)
  server/
    dsql.ts                NEW  pool singleton + DSQL IAM signer + occRetry()
    ledger.ts              NEW  typed DSQL queries: insertSaleTxn, getLedgerFeed,
                                getStatement, reconciliation, outbox claim/list
    engine.ts              NEW  recordSale orchestration (DDB upline → DSQL txn →
                                propagate); Phase C: outbox drain + apply
    repository.ts          MOD  remove sale/ledger writes; export addToVolume;
                                add putHealthRollup/getHealthRollup
    health.ts              MOD  reuse computation for rollup writes
    seed.ts                MOD  add DSQL historical sales/ledger, reconciled
    validate.ts            MOD  zod schemas replace hand-rolled checks
scripts/
  dsql-schema.ts           NEW  idempotent DDL migration (run with tsx)
  dsql-ping.ts             NEW  connectivity smoke test
  reconcile.ts             NEW  DSQL ledger sums vs DDB aggregates (acceptance gate)
  acceptance-p2.ts         NEW  Phase-B gate: atomicity, idempotency, gating
app/api/
  sales/route.ts           MOD  zod + call engine
  distributors/[id]/ledger/route.ts  MOD  read from DSQL
  seed/route.ts            NEW  POST, guarded by SEED_TOKEN
  jobs/drain-outbox/route.ts NEW Phase C worker (cron + inline trigger, guarded)
  stream/[id]/route.ts     NEW  SSE volume ticker
components/dashboard.tsx   MOD  (Task 14 only) SSE with polling fallback
vercel.json                NEW  cron definition
docs/superpowers/plans/…   this file
README.md                  REWRITE (Phase D)
docs/architecture.svg      NEW (Phase D)
tests/ (vitest)            NEW  commission.test.ts, ledger-mapping.test.ts,
                                outbox-payload.test.ts
```

Branch strategy: all work on branch `feat/dsql-ledger` (v0 pushes to `main`; don't fight it). Merge to `main` at the end of each phase gate after acceptance passes.

---

# Phase A — Foundations (test infra, pure engine math, DSQL provision + client + schema)

### Task 1: Branch + vitest + extract pure path/commission module (TDD)

**Files:**
- Create: `lib/commission.ts`, `tests/commission.test.ts`, `vitest.config.ts`
- Modify: `package.json` (scripts) — the engine adopts this module in Task 6

- [ ] **Step 1: Branch + install vitest**

```bash
git checkout -b feat/dsql-ledger
pnpm add -D vitest
```

Add to `package.json` scripts: `"test": "vitest run", "test:watch": "vitest"`.

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["tests/**/*.test.ts"] },
})
```

- [ ] **Step 2: Write the failing test**

`tests/commission.test.ts`:

```ts
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
})
```

- [ ] **Step 3: Run to verify it fails** — `pnpm test` → FAIL (module not found).

- [ ] **Step 4: Implement `lib/commission.ts`**

```ts
import { createHash } from "node:crypto"
import { COMMISSION_RATES } from "@/lib/types"

/** Ancestor ids from a materialized path, nearest-first, excluding self. */
export function ancestorsOf(path: string): string[] {
  return path.split("/").slice(0, -1).reverse()
}

export interface CommissionLine {
  txnId: string
  beneficiaryId: string
  level: number
  amount: number
}

/**
 * Unilevel payout: volume-based rates to the nearest maxDepth ancestors.
 * txn_id is a deterministic hash of (saleId, beneficiaryId) so a retried
 * sale can never double-insert a ledger row.
 */
export function computeCommissions(input: {
  saleId: string
  sellerPath: string
  volume: number
}): CommissionLine[] {
  return ancestorsOf(input.sellerPath)
    .slice(0, COMMISSION_RATES.length)
    .map((beneficiaryId, i) => ({
      txnId: deterministicTxnId(input.saleId, beneficiaryId),
      beneficiaryId,
      level: i + 1,
      amount: round2(input.volume * COMMISSION_RATES[i]),
    }))
}

export function deterministicTxnId(saleId: string, beneficiaryId: string): string {
  return createHash("sha256").update(`${saleId}:${beneficiaryId}`).digest("hex").slice(0, 32)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
```

> NOTE the deliberate behavior change vs current repo: commissions are **volume-based** (`V * rate`, spec §4), not amount-based. The engine swap in Task 6 adopts this.

- [ ] **Step 5: Run tests** — `pnpm test` → PASS. Also `pnpm exec tsc --noEmit` → clean.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: pure commission module with deterministic txn ids (vitest)"`

### Task 2: Provision Aurora DSQL via Vercel Marketplace (manual + verify)

**Files:** none in repo; `.env.local` gains DSQL vars.

- [ ] **Step 1 (USER ACTION — pause and hand to the user):** In the Vercel dashboard → project `plexus-commission-dashboard-f1` → Storage (or Integrations → AWS Marketplace integration) → add an **Aurora DSQL** resource in the same AWS integration that provisioned DynamoDB, region matching `AWS_REGION` (check `.env.local`). Take the **storage-config screenshot now** (Phase D deliverable) showing BOTH DynamoDB and Aurora DSQL attached.

- [ ] **Step 2: Pull env + inspect what arrived**

```bash
vercel env pull .env.local
grep -E "DSQL|AURORA|PG|POSTGRES" .env.local | sed 's/=.*/=***/'
```

Expected: a cluster endpoint var (name unknown until it arrives — likely `DSQL_ENDPOINT`, `AURORA_DSQL_ENDPOINT`, or an ARN). Record the exact names; Task 4's config reads them with explicit fallbacks. If the integration exposes a separate role ARN for DSQL, note it.

- [ ] **Step 3: Commit nothing** (env is gitignored). Document the var names in the plan-progress notes.

### Task 3: DSQL client — pool, IAM signer, OCC retry

**Files:**
- Create: `lib/server/dsql.ts`, `scripts/dsql-ping.ts`
- Modify: `package.json` (deps)

- [ ] **Step 1: Install deps** — `pnpm add pg @aws-sdk/dsql-signer && pnpm add -D @types/pg tsx`

- [ ] **Step 2: Implement `lib/server/dsql.ts`** (no test runner against live DB; verification is the ping script)

```ts
import { Pool } from "pg"
import { DsqlSigner } from "@aws-sdk/dsql-signer"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

// Adjust to the env var names recorded in Task 2.
// IMPORTANT: no top-level env validation or signer construction — this module
// is transitively imported by pure unit tests (ledger mapper, outbox payload)
// where .env.local is not loaded. Everything env-dependent lives inside
// getPool() so importing the module is always safe.
let pool: Pool | undefined

/** Lazy singleton — IAM token fetched per new connection (tokens expire ~15min). */
export function getPool(): Pool {
  if (pool) return pool
  const ENDPOINT =
    process.env.DSQL_ENDPOINT ?? process.env.AURORA_DSQL_ENDPOINT ?? ""
  const REGION = process.env.AWS_REGION as string
  if (!ENDPOINT) throw new Error("DSQL endpoint env var is not set")

  const signer = new DsqlSigner({
    hostname: ENDPOINT,
    region: REGION,
    credentials: awsCredentialsProvider({
      roleArn: process.env.AWS_ROLE_ARN as string,
      clientConfig: { region: REGION },
    }),
  })
  pool = new Pool({
    host: ENDPOINT,
    port: 5432,
    database: "postgres",
    user: "admin",
    password: () => signer.getDbConnectAdminAuthToken(),
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30_000,
  })
  return pool
}

/** Retry on DSQL optimistic-concurrency conflicts (SQLSTATE 40001). */
export async function occRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === "40001" && i < attempts - 1) continue
      throw e
    }
  }
}
```

> If the marketplace integration provisions a non-admin DB role, switch to `getDbConnectAuthToken()` and the provided username — decide from Task 2's actual env vars.

- [ ] **Step 3: Ping script** `scripts/dsql-ping.ts`:

```ts
import { config } from "dotenv"
config({ path: ".env.local" })
const { getPool } = await import("../lib/server/dsql")
const res = await getPool().query("SELECT 1 AS ok, current_database() AS db")
console.log(res.rows)
process.exit(0)
```

(`dotenv` ships transitively; if not: `pnpm add -D dotenv`.)

- [ ] **Step 4: Run** — `pnpm exec tsx scripts/dsql-ping.ts` → `[ { ok: 1, db: 'postgres' } ]`. If auth fails, refresh OIDC token (`vercel env pull`) and re-check role/var names before touching code.

- [ ] **Step 5: Commit** — `git commit -m "feat: Aurora DSQL client with OIDC IAM auth and OCC retry"`

### Task 4: DSQL schema migration (DSQL-adapted DDL)

**Files:** Create: `scripts/dsql-schema.ts`

- [ ] **Step 1: Write the migration script** — statements executed one at a time (DSQL: one DDL per transaction), all idempotent:

```ts
import { config } from "dotenv"
config({ path: ".env.local" })
const { getPool } = await import("../lib/server/dsql")

// DSQL adaptations vs the spec's reference DDL (README documents these):
// - no FOREIGN KEY support -> relationship enforced in code
// - no sequences/identity  -> outbox UUID pk, ordered by created_at
// - CREATE INDEX ASYNC     -> DSQL builds indexes via async jobs
const statements = [
  `CREATE TABLE IF NOT EXISTS sales (
     sale_id    UUID PRIMARY KEY,
     seller_id  TEXT NOT NULL,
     product_id TEXT,
     amount     NUMERIC(12,2) NOT NULL,
     volume     NUMERIC(12,2) NOT NULL,
     sale_type  TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ledger (
     txn_id         TEXT PRIMARY KEY,
     sale_id        UUID NOT NULL,
     beneficiary_id TEXT NOT NULL,
     source_id      TEXT NOT NULL,
     source_name    TEXT,
     level          INT NOT NULL,
     amount         NUMERIC(12,2) NOT NULL,
     period         TEXT NOT NULL,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS outbox (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     event_type   TEXT NOT NULL,
     payload      JSONB NOT NULL,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     processed_at TIMESTAMPTZ
   )`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_ledger_beneficiary
     ON ledger (beneficiary_id, created_at DESC)`,
  `CREATE INDEX ASYNC IF NOT EXISTS idx_outbox_pending
     ON outbox (created_at) WHERE processed_at IS NULL`,
]

const pool = getPool()
for (const sql of statements) {
  console.log(sql.split("\n")[0], "…")
  await pool.query(sql)
}
console.log("schema OK")
process.exit(0)
```

> `source_name` is a deliberate display-only denormalization so the feed never joins across stores. If `CREATE INDEX ASYNC IF NOT EXISTS` or the partial index is rejected by DSQL, drop `IF NOT EXISTS`/the `WHERE` clause and wrap in a try/catch on "already exists" — adjust at run time and note it.

- [ ] **Step 2: Run** — `pnpm exec tsx scripts/dsql-schema.ts` → `schema OK`. Verify: `SELECT table_name FROM information_schema.tables WHERE table_schema='public'` via ping-style one-liner → `sales, ledger, outbox`.

- [ ] **Step 3: Commit** — `git commit -m "feat: DSQL schema migration (sales, ledger, outbox; DSQL-adapted DDL)"`

---

# Phase B — Money moves to DSQL (engine, reads, seed, acceptance) — spec Phase 1+2 gate

### Task 5: Typed DSQL query layer

**Files:** Create: `lib/server/ledger.ts`; Create: `tests/ledger-mapping.test.ts`

- [ ] **Step 1: Failing test for the row mapper** (pure part):

```ts
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
```

- [ ] **Step 2: Run → FAIL.** Implement `lib/server/ledger.ts`:

```ts
import type { PoolClient } from "pg"
import { getPool, occRetry } from "./dsql"
import { computeCommissions, type CommissionLine } from "@/lib/commission"
import type { LedgerEntry, Sale } from "@/lib/types"

export interface LedgerRow {
  txn_id: string; sale_id: string; beneficiary_id: string; source_id: string
  source_name: string | null; level: number; amount: string; period: string
  created_at: Date
}

export function toLedgerEntry(r: LedgerRow): LedgerEntry {
  return {
    txnId: r.txn_id, beneficiaryId: r.beneficiary_id, sourceDistId: r.source_id,
    sourceName: r.source_name ?? undefined, level: Number(r.level),
    amount: Number(r.amount), period: r.period,
    timestamp: r.created_at.toISOString(),
  }
}

export interface SaleTxnInput {
  sale: Sale
  sellerName: string
  commissions: CommissionLine[]
  period: string
  /** Phase C: when set, an outbox row commits atomically with the sale. */
  outboxPayload?: object
}

/**
 * THE money write. Sale + every ledger row (+ outbox row) commit in ONE
 * DSQL transaction — a partial payout is impossible. ON CONFLICT DO NOTHING
 * on deterministic PKs makes the whole operation idempotent under retry.
 */
export async function insertSaleTxn(input: SaleTxnInput): Promise<void> {
  await occRetry(async () => {
    const client = await getPool().connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO sales (sale_id, seller_id, product_id, amount, volume, sale_type, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (sale_id) DO NOTHING`,
        [input.sale.saleId, input.sale.distributorId, input.sale.productId,
         input.sale.amount, input.sale.volume, input.sale.type, input.sale.timestamp],
      )
      for (const c of input.commissions) {
        await client.query(
          `INSERT INTO ledger (txn_id, sale_id, beneficiary_id, source_id, source_name, level, amount, period, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (txn_id) DO NOTHING`,
          [c.txnId, input.sale.saleId, c.beneficiaryId, input.sale.distributorId,
           input.sellerName, c.level, c.amount, input.period, input.sale.timestamp],
        )
      }
      if (input.outboxPayload) {
        await client.query(
          `INSERT INTO outbox (event_type, payload) VALUES ('sale.recorded', $1)`,
          [JSON.stringify(input.outboxPayload)],
        )
      }
      await client.query("COMMIT")
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {})
      throw e
    } finally {
      client.release()
    }
  })
}

export async function getLedgerFeed(beneficiaryId: string, limit = 25): Promise<LedgerEntry[]> {
  const res = await getPool().query<LedgerRow>(
    `SELECT txn_id, sale_id, beneficiary_id, source_id, source_name, level, amount, period, created_at
     FROM ledger WHERE beneficiary_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [beneficiaryId, limit],
  )
  return res.rows.map(toLedgerEntry)
}

/** Monthly statement — the SQL-auditability story (access pattern #10). */
export async function getStatement(beneficiaryId: string, period: string) {
  const res = await getPool().query(
    `SELECT l.period, COUNT(*)::int AS txn_count, SUM(l.amount)::float8 AS total,
            COUNT(DISTINCT l.sale_id)::int AS sales_count
     FROM ledger l WHERE l.beneficiary_id = $1 AND l.period = $2 GROUP BY l.period`,
    [beneficiaryId, period],
  )
  return res.rows[0] ?? { period, txn_count: 0, total: 0, sales_count: 0 }
}

/** Reconciliation source: per-beneficiary-per-period ledger sums. */
export async function getLedgerSums(): Promise<
  { beneficiary_id: string; period: string; total: number }[]
> {
  const res = await getPool().query(
    `SELECT beneficiary_id, period, SUM(amount)::float8 AS total
     FROM ledger GROUP BY beneficiary_id, period`,
  )
  return res.rows
}

export { computeCommissions }
export type { PoolClient }
```

- [ ] **Step 3: Run tests → PASS**, `pnpm exec tsc --noEmit` clean.
- [ ] **Step 4: Commit** — `git commit -m "feat: typed DSQL ledger layer with single-transaction sale write"`

### Task 6: Engine swap — `recordSale` orchestrates DDB → DSQL → DDB

**Files:**
- Create: `lib/server/engine.ts`
- Modify: `lib/server/repository.ts` (delete `recordSale`, `RecordSaleInput/Result`, the `keys.sale/ledger` writes, `getLedger`; **export** `addToVolume`)
- Modify: `app/api/sales/route.ts` (import from engine)
- Modify: `app/api/distributors/[id]/ledger/route.ts` (swap deleted `getLedger` → `getLedgerFeed` from `@/lib/server/ledger` — must happen in THIS task or the build breaks)
- Modify: `lib/server/seed.ts` (repoint its `recordSale` import at `@/lib/server/engine` — signature-compatible; full seed rework is Task 9)

- [ ] **Step 1: Implement `lib/server/engine.ts`:**

```ts
import { randomUUID } from "node:crypto"
import { computeCommissions } from "@/lib/commission"
import { insertSaleTxn } from "./ledger"
import { addToVolume, getDistributor } from "./repository"
import { currentPeriod, type LedgerEntry, type Sale, type SaleType } from "@/lib/types"

export interface RecordSaleInput {
  distributorId: string
  productId: string
  amount: number
  volume: number
  type: SaleType
  /** Client may supply for end-to-end idempotency; generated otherwise. */
  saleId?: string
}

export interface RecordSaleResult {
  sale: Sale
  commissions: LedgerEntry[]
}

/**
 * The commission engine (spec §4).
 * 1. Upline from the DynamoDB materialized path — zero traversal.
 * 2. ONE ACID DSQL transaction: sale + all ledger rows (deterministic txn_ids).
 * 3. Propagate derived aggregates to DynamoDB via atomic ADDs (Phase B: sync).
 * DSQL is the source of truth; DynamoDB aggregates are rebuildable from it.
 */
export async function recordSale(
  input: RecordSaleInput,
  at: Date = new Date(),
): Promise<RecordSaleResult> {
  const seller = await getDistributor(input.distributorId)
  if (!seller) throw new Error(`Unknown distributor: ${input.distributorId}`)

  const iso = at.toISOString()
  const period = currentPeriod(at)
  const sale: Sale = {
    saleId: input.saleId ?? randomUUID(),
    distributorId: seller.id,
    productId: input.productId,
    amount: round2(input.amount),
    volume: round2(input.volume),
    type: input.type,
    timestamp: iso,
  }
  const commissions = computeCommissions({
    saleId: sale.saleId,
    sellerPath: seller.path,
    volume: sale.volume,
  })

  // 2 — money, atomically
  await insertSaleTxn({ sale, sellerName: seller.name, commissions, period })

  // 3 — derived read models (sync in Phase B; outbox-driven in Phase C)
  await propagateAggregates(sale, seller.path, commissions, period)

  return {
    sale,
    commissions: commissions.map((c) => ({
      txnId: c.txnId, beneficiaryId: c.beneficiaryId, sourceDistId: seller.id,
      sourceName: seller.name, level: c.level, amount: c.amount,
      period, timestamp: iso,
    })),
  }
}

export async function propagateAggregates(
  sale: Sale,
  sellerPath: string,
  commissions: { beneficiaryId: string; amount: number }[],
  period: string,
): Promise<void> {
  const volumeField = sale.type === "retail" ? "retailVolume" : "starterVolume"
  const paid = new Map(commissions.map((c) => [c.beneficiaryId, c.amount]))
  const ancestors = sellerPath.split("/").slice(0, -1).reverse()
  await Promise.all([
    addToVolume(sale.distributorId, period, {
      pv: sale.volume, gv: sale.volume, [volumeField]: sale.volume,
    }),
    ...ancestors.map((id) =>
      addToVolume(id, period, {
        gv: sale.volume,
        ...(paid.has(id) ? { commissionEarned: paid.get(id)! } : {}),
      }),
    ),
  ])
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 2: Strip `repository.ts` and fix ALL importers in the same step** — delete `recordSale/RecordSaleInput/RecordSaleResult/getLedger`, change `function addToVolume` → `export async function addToVolume`. Remove now-unused `keys.sale`/`keys.ledger` from `dynamo.ts` and `Sale`-item writes. Then: `app/api/sales/route.ts` imports `recordSale` from `@/lib/server/engine`; `app/api/distributors/[id]/ledger/route.ts` swaps `getLedger(id)` → `getLedgerFeed(id)` from `@/lib/server/ledger` (same `LedgerEntry[]` response shape — mapper already matches); `lib/server/seed.ts` imports `recordSale` from `@/lib/server/engine`. The build is only whole after all four files change together.

- [ ] **Step 3: Verify** — `pnpm test && pnpm exec tsc --noEmit` clean; `pnpm dev` then:

```bash
curl -s -X POST localhost:3000/api/sales -H 'content-type: application/json' \
  -d '{"distributorId":"038","productId":"SKU-1","amount":100,"volume":100,"type":"retail"}'
curl -s localhost:3000/api/distributors/001/ledger | head -c 400
```

Expected: 201 with sale + 5 volume-based commissions; the ledger GET returns the new entries from DSQL; dashboard feed renders unchanged. (Same-`saleId` idempotency is verified in Task 8 — the route can't pass `saleId` through until the zod schema adds it.)

- [ ] **Step 4: Commit** — `git commit -m "feat: commission engine writes money to DSQL atomically, propagates DDB aggregates"`

### Task 7: Monthly statement endpoint (access pattern #10, demonstrably runnable)

**Files:** Modify: `app/api/distributors/[id]/ledger/route.ts`

- [ ] **Step 1:** Support `?statement=<YYYY-MM>` on the ledger route: when present, return `getStatement(id, period)` (`{period, txn_count, total, sales_count}`) instead of the feed. Validate the period with zod regex `/^\d{4}-\d{2}$/` (reject otherwise, 400).
- [ ] **Step 2: Verify** — `curl -s "localhost:3000/api/distributors/001/ledger?statement=2026-06"` returns the aggregate row matching the feed's sum for the period.
- [ ] **Step 3: Commit** — `git commit -m "feat: monthly commission statement via SQL aggregate"`

### Task 8: zod validation

**Files:** Modify: `lib/server/validate.ts`, `app/api/sales/route.ts`, `app/api/billing/upgrade/route.ts`

- [ ] **Step 1:** `pnpm add zod`. In `validate.ts` add:

```ts
import { z } from "zod"
export const distId = z.string().regex(/^\d{3}$/)
export const saleBody = z.object({
  distributorId: distId,
  productId: z.string().regex(/^[A-Z0-9-]{2,32}$/),
  amount: z.number().positive().max(100_000),
  volume: z.number().positive().max(100_000),
  type: z.enum(["retail", "starter"]),
  saleId: z.string().uuid().optional(),
})
export const upgradeBody = z.object({ distributorId: distId })
```

Routes call `saleBody.safeParse(body)` → 400 with `result.error.issues[0].message` on failure. The sales route forwards the (now-validated) optional `saleId` to the engine. Keep `badRequest/notFound/serverError` helpers.
- [ ] **Step 2: Verify** — invalid POST returns 400; valid sale still 201. **End-to-end idempotency now provable:** POST the same body with a fixed `"saleId": "<uuid>"` twice → second returns 201 with identical txnIds and `SELECT count(*) FROM ledger` is unchanged. `pnpm test` green.
- [ ] **Step 3: Commit** — `git commit -m "refactor: zod-validated API inputs"`

### Task 9: Seed v2 — both stores, reconciled, idempotent + guarded `/api/seed`

**Files:** Modify: `lib/server/seed.ts`; Create: `app/api/seed/route.ts`; Modify: `scripts/reset-data.mjs` (or replace with `scripts/seed.ts`)

- [ ] **Step 1: Seed CONFIG items (they do NOT exist in the current repo — this task creates them).** Add `keys.configPK()` to `dynamo.ts` and seed: `PK=CONFIG SK=PLAN {planType:"unilevel", levelRates:[0.10,0.05,0.03,0.02,0.01], maxDepth:5}` plus five `PK=CONFIG SK=RANK#<order>` items (`Associate 0/0, Builder 500/100, Director 2000/200, Executive 5000/300, Diamond 12000/400` as `minGv/minPv` — tune so the seeded volumes produce a spread of ranks). Add `getConfig()` to `repository.ts`: one `Query(PK=CONFIG)` returning `{plan, ranks}` (access pattern #7, demonstrably runnable). Then make rank **computed lazily on read** per spec: `app/api/distributors/[id]/route.ts` derives rank from the seller's current-period `gv/pv` vs the RANK thresholds (highest rank whose minima are met) instead of trusting the stored META `rank`; keep the stored field as a seed-time default for list views, and note in the README that the profile read is the authoritative, lazily-computed rank.

- [ ] **Step 1b: Extend seed for the dual-store data** — keep the 40-seller tree. Replace its sale generation with: ~80 deterministic historical sales (`saleId = uuidv5`-style hash or `sha256(seed-sale-<n>)` formatted as UUID) spread across current + previous period, mixed retail/starter, ≥2 starter-heavy subtrees (e.g. under `010` and `027`). For each: `insertSaleTxn` (DSQL) + `propagateAggregates` (DDB) — i.e., seed runs the real engine path with fixed timestamps, so the stores **reconcile by construction**. Before seeding, wipe: `DELETE FROM ledger; DELETE FROM sales; DELETE FROM outbox;` and (existing) DDB item sweep. Idempotent: deterministic ids + ON CONFLICT DO NOTHING means double-seed without wipe also stays consistent.
- [ ] **Step 2: `app/api/seed/route.ts`** — `POST`, requires header `x-seed-token === process.env.SEED_TOKEN` (set in Vercel env + `.env.local`), 401 otherwise; calls the seed lib; returns counts `{sellers, sales, ledgerRows}`.
- [ ] **Step 3: Verify** — run seed; spot-check: previous-period volumes exist; `SELECT count(*) FROM sales` ≈ 80; `Query(PK=CONFIG)` returns PLAN + 5 RANK items; `GET /api/distributors/001` returns a rank consistent with 001's gv/pv vs thresholds; UI shows alive dashboard for `001`.
- [ ] **Step 4: Commit** — `git commit -m "feat: dual-store reconciled seed + guarded /api/seed"`

### Task 10: Reconciliation script + Phase-B ACCEPTANCE GATE

**Files:** Create: `scripts/reconcile.ts`, `scripts/acceptance-p2.ts`

- [ ] **Step 1: `scripts/reconcile.ts`** — pulls `getLedgerSums()` (DSQL) and every `VOLUME#` item's `commissionEarned` (DDB, via the TREE partition list + BatchGet — no Scan), diffs per (beneficiary, period), prints a table, exits non-zero on any mismatch > $0.01. This is the "aggregates are rebuildable/auditable" proof.
- [ ] **Step 2: `scripts/acceptance-p2.ts`** — automated gate, run with `pnpm exec tsx`:
  1. **Atomicity:** monkey-patch one ledger INSERT to throw mid-transaction (inject a poisoned commission with `amount = NaN` → DSQL rejects), then assert `SELECT count(*) FROM sales WHERE sale_id=$poisoned` = 0 AND ledger rows = 0 (rollback proven).
  2. **Idempotency:** call `recordSale` twice with the same `saleId`; assert ledger count unchanged after 2nd call; DDB aggregates incremented once *(propagation runs once because insert is conflict-skipped — assert engine returns same txnIds)*.
  3. **Correctness:** deep seller (depth 6) sale of volume 100 → exactly 5 ledger rows at 10/5/3/2/1; every ancestor's `gv` +100; payer aggregates match.
  4. **Gating:** GET health for a `free` seller → `gated: true`, no `score` key; downline for free seller never contains depth > +3; after `POST /api/billing/upgrade` both unlock.
  5. **Statement (access pattern #10):** `GET /ledger?statement=<period>` for a beneficiary → `total` equals the sum of that beneficiary's feed entries for the period.
  6. **Reconcile:** run script from Step 1 → zero mismatches.
- [ ] **Step 3: Run the gate → all green. Fix anything red before proceeding (hard gate).**
- [ ] **Step 4: Deploy check** — push branch, Vercel preview build green, run one sale against preview URL.
- [ ] **Step 5: Commit + merge** — `git commit -m "test: Phase-B acceptance gate (atomicity, idempotency, gating, reconciliation)"`; merge `feat/dsql-ledger` → `main` (PR or fast-forward; pull v0's main first). **This is the complete submittable app.**

---

# Phase C — Outbox, async health rollups, SSE (spec Phase 3)

### Task 11: Transactional outbox + drainer with exactly-once DDB application

**Files:**
- Create: `app/api/jobs/drain-outbox/route.ts`, `tests/outbox-payload.test.ts`, `vercel.json`
- Modify: `lib/server/engine.ts` (outbox payload + drain logic + inline trigger), `lib/server/ledger.ts` (claim/list queries)

- [ ] **Step 1: Failing test for the pure payload builder** — `buildOutboxPayload(sale, sellerPath, commissions, period)` returns `{saleId, sellerId, period, volume, saleType, sellerPath, beneficiaries:[{id, level, amount}]}`; assert shape + that it contains everything `propagateAggregates` needs (no DDB read required at drain time).
- [ ] **Step 2: Implement.** Engine change: `recordSale` now passes `outboxPayload` into `insertSaleTxn` (atomic with the money) and **stops calling `propagateAggregates` directly**; instead, after commit it fire-and-forgets `drainOutbox()` (await-less with `.catch(console.error)`) so the demo stays instant, while the cron sweeps anything a crash leaves behind.
- [ ] **Step 3: Drain logic in `engine.ts`:**

```ts
/**
 * Drain pending outbox events.
 *
 * ORDER MATTERS — apply FIRST, mark processed SECOND:
 * at-least-once delivery (a crash between apply and mark just means the
 * event is re-delivered) + an idempotent apply (the EVENT#<id> marker makes
 * re-application a no-op) = effective exactly-once across two databases.
 * The reverse order (mark-then-apply) silently LOSES the event if the
 * drainer dies in between — the cron sweep only retries processed_at IS NULL.
 */
export async function drainOutbox(limit = 25): Promise<number> { /* …
  1. SELECT id, payload FROM outbox WHERE processed_at IS NULL
     ORDER BY created_at LIMIT $1
  2. per event — APPLY to DynamoDB first:
     TransactWriteCommand: [ Put EVENT#<outboxId> marker
       (PK=EVENT#<id>, SK=APPLIED, ConditionExpression
        attribute_not_exists(PK)), ...Update ADDs identical to
       propagateAggregates ]
     → success ⇒ first application
     → TransactionCanceledException w/ ConditionalCheckFailed on the marker
       ⇒ a previous (crashed or concurrent) drain already applied it — fine,
       fall through to step 3 so the row finally gets marked
     → any other error ⇒ leave processed_at NULL (event will be retried),
       log, continue with next event
  3. only after apply: UPDATE outbox SET processed_at=now()
     WHERE id=$1 AND processed_at IS NULL
  4. recompute + write HEALTH#period rollups for the seller's ancestor
     chain (Task 13)
… */ }
```

Concurrent drainers racing the same event are harmless: both attempt the DDB transaction, exactly one wins the marker condition, both mark `processed_at` (idempotent UPDATE).

  (Write it concretely; reuse `addToVolume`'s expression-building by extracting a `volumeAddAction(id, period, fields)` helper that returns the `Update` element for the transaction. Add `keys.eventPK(outboxId)` to `dynamo.ts` — repo convention is keys via helpers only.)
- [ ] **Step 4: Route** `app/api/jobs/drain-outbox/route.ts` — `GET` (Vercel cron sends GET), guard: `authorization: Bearer ${process.env.CRON_SECRET}` or `x-seed-token` fallback for manual runs; returns `{drained}`. `vercel.json`: `{"crons":[{"path":"/api/jobs/drain-outbox","schedule":"* * * * *"}]}`. **Env setup (do it now, like SEED_TOKEN in Task 9):** generate a secret (`openssl rand -hex 16`), `vercel env add CRON_SECRET` (all environments) + add to `.env.local`; Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron invocations when the var exists. **Tier note:** per-minute cron schedules require a Pro-tier Vercel team — on Hobby the schedule is coerced to daily. That's acceptable here because the inline post-commit drain does the real-time work and the cron is only the crash sweeper; verify the team's tier and, if Hobby, document the daily sweep cadence in the README honesty note.
- [ ] **Step 5: Verify (crash-survival demo, the Phase-3 acceptance):** temporarily comment out the inline drain → record a sale → DSQL has sale+ledger+outbox, DDB aggregates unchanged → run drainer manually → aggregates land; run drainer **again** → `{drained: 0}`, aggregates unchanged (idempotency marker proof). Restore inline drain.
- [ ] **Step 6: Commit** — `git commit -m "feat: transactional outbox with exactly-once DynamoDB application"`

### Task 12: Lambda + Streams attempt (timeboxed: 1 hour)

**Files:** none expected to land; findings → `docs/notes/streams-lambda-attempt.md`

- [ ] **Step 1:** With pulled OIDC creds, attempt `aws dynamodb update-table --table-name $DYNAMODB_TABLE_NAME --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES` (assume role via the integration's role ARN). Expected: **AccessDenied** (integration boundary has no UpdateTable — already proven by the GSI history).
- [ ] **Step 2:** If denied (likely): document the attempt + error verbatim in `docs/notes/streams-lambda-attempt.md`; the cron drainer (Task 11) is the sanctioned fallback, and the README/video frame it honestly: "the outbox pattern is runtime-agnostic — in an unconstrained account the drainer is a Lambda on a Streams/SQS trigger; under the marketplace IAM boundary it runs as a scheduled function."  If allowed (unlikely): enable stream, add `infra/lambda-health/` with a minimal handler mirroring `drainOutbox`'s health-rollup step, deploy manually, document.
- [ ] **Step 3: Commit** — `git commit -m "docs: Streams/Lambda feasibility findings under marketplace IAM boundary"`

### Task 13: Async HEALTH rollups + route fast-path

**Files:** Modify: `lib/server/health.ts` (export a `computeNetworkHealth` already exists as `getNetworkHealth` — reuse), `lib/server/repository.ts` (add `putHealthRollup`, `getHealthRollup`), `lib/server/engine.ts` (drain step 4), `app/api/distributors/[id]/health/route.ts`

- [ ] **Step 1:** `putHealthRollup(id, period, health)` writes `PK=DIST#<id> SK=HEALTH#<period>` with `{score, recruitmentRatio, flaggedCount, nodes (full JSON), updatedAt}`; `getHealthRollup` reads it. In `drainOutbox`, after applying an event: for the source seller's ancestor chain (root → seller), call `getNetworkHealth(id)` and `putHealthRollup` (≤6 nodes deep; ~40-member network — cheap).
- [ ] **Step 2:** Health route (Pro path): try `getHealthRollup(id, period)`; if present and `updatedAt` ≥ newest aggregate write (or simply present — document staleness window ≤ drain latency), return it (**GetItem fast path, no subtree query**); else fall back to live compute (graceful degradation when worker is down = spec acceptance). Response gains `source: "rollup" | "live"` for demo visibility.
- [ ] **Step 3: Verify** — record sale → drain → `GET /health` shows `source: "rollup"`; delete the rollup item → `source: "live"` still 200.
- [ ] **Step 4: Commit** — `git commit -m "feat: async HEALTH#period rollups maintained by outbox drainer"`

### Task 14: SSE live updates

**Files:** Create: `app/api/stream/[id]/route.ts`; Modify: `components/dashboard.tsx` (and/or the SWR hook)

- [ ] **Step 1: SSE route** — `GET`, validates id, returns `ReadableStream` with `text/event-stream` headers; loop: every 2s `GetItem VOLUME#<period>` (+ ledger head txn via cheap `getLedgerFeed(id,1)`), emit `data: {...}\n\n` only when changed; heartbeat comment every 15s; abort on `request.signal`. `export const dynamic = "force-dynamic"`, `maxDuration = 60` (reconnect via `EventSource` auto-retry covers the duration cap).
- [ ] **Step 2: Dashboard** — `EventSource` to `/api/stream/<id>`; on message, `mutate()` the SWR keys; on `onerror`, close and rely on existing SWR polling (fallback per spec). Demo beat: deep sale → upline cards tick without reload.
- [ ] **Step 3: Verify** — two browser windows (seller `038` + ancestor `001`), record sale as `038`, watch `001`'s earnings card tick within ~2s.
- [ ] **Step 4: Commit** — `git commit -m "feat: SSE live volume stream with polling fallback"`

### Task 15: Phase-C ACCEPTANCE GATE

- [ ] Ledger write + outbox row commit together (kill the propagation path; verify outbox row exists whenever ledger rows do — query both post-crash-sim).
- [ ] Propagation survives an app crash mid-request (Task 11 Step 5 re-run, via API not direct call).
- [ ] Double-drain is a no-op (idempotency marker).
- [ ] Health route degrades gracefully with drainer disabled (`source: "live"`).
- [ ] `pnpm test`, `tsc --noEmit`, `scripts/reconcile.ts` all green; preview deploy green; merge to `main`.

---

# Phase D — Submission artifacts

### Task 16: README rewrite

- [ ] Sections in order: hero one-liner + live URL · **Why two databases (spec §2.1 verbatim)** · architecture diagram (embed) · **the 10-access-pattern table (spec §3.4 verbatim, with the as-built TREE/PARENT note)** · single-table materialized-path explainer · consistency model (DSQL source of truth, DDB derived/rebuildable, outbox exactly-once application) · **deliberate deviations** (TREE/PARENT vs GSIs under the IAM boundary; DSQL DDL adaptations: no FKs, no sequences, INDEX ASYNC; cron-as-Lambda note with link to `docs/notes/streams-lambda-attempt.md`) · monetization (one paragraph, Free/Pro table) · local setup (`vercel env pull`, `pnpm i`, schema script, seed, dev) · scripts reference. MIT `LICENSE` file. Confirm `.env*` gitignored, no secrets in history.
- [ ] Commit.

### Task 17: Architecture diagram

- [ ] Create `docs/architecture.svg` (Excalidraw or draw.io, AWS Architecture Icons): Browser → Vercel (Next.js UI + Route Handlers) → split arrows to **Aurora DSQL** (sales+ledger+outbox, "ACID, source of truth") and **DynamoDB** (single table: META/TREE/PARENT/VOLUME/HEALTH/CONFIG, "access-pattern reads") → outbox → drainer (scheduled function; "Lambda in unconstrained accounts") → DDB transactional apply + HEALTH rollups; SSE back to browser. Dashed box around AWS services. Every box labeled what-it-is + what-it-does.
- [ ] Embed in README; commit.

### Task 18: Submission checklist run

- [ ] Production deploy green; record Vercel **Team ID** (`team_mESdvS3Vca3o0a9paZo522Ok`) + live URL.
- [ ] Storage-config screenshots (both DBs) — captured in Task 2; retake post-merge if UI changed.
- [ ] Run the full hero demo flow on production once end-to-end (record sale deep → live upline ticks → health paywall → upgrade → instant unlock).
- [ ] Video (3–5 min) per spec §11 beat sheet — lead with the access-pattern table + two-database split, then the live flow, then the diagram walk. Keep the §15/§16 framing rules (no "MLM", retail-led narrative, one-sentence monetization).
- [ ] Bonus post draft (dev.to/LinkedIn) per spec §12, tagged #H0Hackathon, line "I built this project for the H0 Hackathon." included.

---

## Risks & contingencies

| Risk | Mitigation |
|---|---|
| Marketplace doesn't offer DSQL / provisions slowly | Fall back to manual DSQL cluster in user's AWS account; only `lib/server/dsql.ts` env wiring changes. |
| OIDC role lacks `dsql:DbConnectAdmin` | Integration normally grants it for its own resource; if not, use the integration-provided DB role + `getDbConnectAuthToken`. |
| `CREATE INDEX ASYNC IF NOT EXISTS` syntax mismatch | Adjust DDL at run time (Task 4 note); never blocks tables. |
| DSQL OCC conflicts under demo load | `occRetry` everywhere; demo is single-user anyway. |
| Vercel cron min granularity 1 min feels slow | Inline post-commit drain trigger makes propagation instant; cron is only the crash sweeper. |
| SSE on serverless duration limits | `maxDuration=60` + EventSource auto-reconnect + SWR polling fallback. |
| v0 pushes to `main` mid-build | All work on `feat/dsql-ledger`; pull/rebase before each merge. |
