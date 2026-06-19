# Plexus — H0 Hackathon Submission Package

> Track 1 — Monetizable B2C App · Vercel v0 + AWS Databases · Deadline Jun 29, 2026

## Deliverables checklist

| # | Deliverable | Status | Notes |
|---|-------------|--------|-------|
| 1 | Public GitHub repo, MIT license, no secrets | ✅ | `keshavdalmia10/plexus`, `LICENSE` (MIT), `.env*` gitignored |
| 2 | README: why-two-DBs, access-pattern table, consistency model, deviations, setup | ✅ | `README.md` |
| 3 | Architecture diagram | ✅ | `docs/architecture.svg` (embedded in README) |
| 4 | Live Vercel URL | ⏳ merge | `https://plexus-commission-dashboard-f1.vercel.app` — **needs `feat/dsql-ledger` merged to `main`** to deploy the polyglot build |
| 5 | Vercel Team ID | ✅ | `team_mESdvS3Vca3o0a9paZo522Ok` |
| 6 | Storage screenshot(s) proving BOTH DynamoDB + Aurora DSQL | ☐ you | Vercel dashboard → project → Storage; screenshot both resources attached |
| 7 | 3–5 min video | ☐ you | Script below |
| 8 | Bonus content (dev.to / LinkedIn) | ☐ you | Draft below |

✅ done · ⏳ one action away · ☐ your action

## Proof the build works (cite in video / write-up)
- **Phase-B acceptance gate: 7/7** — `scripts/acceptance-p2.ts` (seed reconcile, DSQL rollback atomicity, idempotency, 5-level cascade, statement=feed, API gating, final reconcile)
- **Phase-C acceptance gate: 5/5** — `scripts/acceptance-p3.ts` (outbox atomicity, crash-survival, exactly-once apply, health rollup, invariants post-propagation)
- **Reconcile: zero drift across 36 beneficiary-periods** — `scripts/reconcile.ts`
- **19/19 unit tests** — `pnpm test`

---

## Video script (3–5 min) — lead with architecture, not a UI tour

**0:00–0:30 — Problem & who.** "Plexus is the income cockpit for an individual direct-sales seller. Today, back-office tools batch commissions monthly and hide where your money comes from. Plexus shows it in real time — and flags whether your network's volume is genuine retail or just sign-ups."

**0:30–1:45 — The data model (the part that wins).** Show the README access-pattern table on screen. Say it out loud:
- "Two AWS databases, each chosen for what it's best at. **DynamoDB owns the network** — a single-table design with a materialized path. A seller's upline is free: I parse the path string, zero DB calls. A subtree is one `begins_with` query. No joins, no scans, ever."
- "**Aurora DSQL owns the money** — the sale and every commission row commit in one ACID transaction. Partial payouts are impossible. Deterministic `txn_id`s make it idempotent under retry."
- "They're connected by a **transactional outbox**: the outbox row commits inside the same DSQL transaction as the money, and a drainer applies aggregates to DynamoDB **exactly-once** with an idempotency marker. DSQL is the source of truth; the DynamoDB aggregates are a rebuildable read model — `reconcile.ts` proves zero drift."

**1:45–2:50 — Live demo + monetization.** As a **Free** seller: record a retail sale at a deep node → watch the **upline earnings tick live up the chain** (SSE). Open **Network Health** → hit the **Pro paywall** (gated at the API). Click **Upgrade** → the full network depth + health score **unlock instantly**, no reload. Say: "B2C freemium — the individual seller pays $12/mo for full network visibility and health analytics."

**2:50–3:40 — Architecture walk.** Show `docs/architecture.svg`. Trace the numbered green path: **1** money to DSQL (atomic) → **2** drainer polls the outbox → **3** exactly-once apply to DynamoDB via `TransactWriteItems` + `EVENT#` marker → HEALTH rollups. Close with the honest constraint: "The integration's least-privilege IAM role has no `UpdateTable`, so there are no GSIs and no Streams — the hierarchy is materialized as first-class items and the drainer runs as a Vercel Cron. Same architecture, least-privilege by default. The exactly-once guarantee lives in the application logic, not the trigger."

**Framing rules:** first-person seller value; lead with retail selling, not recruiting; never say "MLM" or "pyramid"; one sentence on monetization, no TAM slides.

---

## Bonus post draft (dev.to / LinkedIn) — tag #H0Hackathon

**Title:** Polyglot persistence for a referral network: a DynamoDB single-table tree + an Aurora DSQL commission ledger

I built Plexus for the H0 Hackathon — a real-time commission engine for direct-sales sellers — and the interesting part is the data layer: two AWS databases, each doing what it's best at.

**The network lives in DynamoDB.** A downline is a deep hierarchy you query by access pattern: a seller's own aggregates, their front line, their full subtree. A single-table design with a *materialized path* (`001/014/207`) serves every one of those in O(1) or O(items-in-subtree): the upline is free (parse the string — no query), a subtree is a `begins_with`, the front line is a partition. No joins, no recursive CTEs, no scans. (And because the managed integration's IAM role can't `UpdateTable`, the GSIs are materialized as first-class `TREE`/`PARENT#` items — same access patterns, different storage.)

**The money lives in Aurora DSQL.** Commissions are financial records that must be correct under concurrency. The sale and all N commission rows commit in one ACID transaction — a partial payout is impossible — and deterministic `txn_id = hash(saleId + beneficiaryId)` makes the whole write idempotent. SQL gives me real monthly statements and reconciliation.

**The bridge is a transactional outbox.** The outbox row commits *inside* the money transaction. A drainer applies the derived aggregates to DynamoDB exactly-once: a single `TransactWriteItems` with a conditional `Put` on an `EVENT#<id>` marker (apply-first, mark-second). Crash mid-drain? The outbox row stays pending and the next run retries cleanly — the marker makes re-application a no-op. DSQL is the source of truth; the DynamoDB aggregates are a rebuildable read model, and a reconcile script proves zero drift.

In an unconstrained AWS account that drainer is a Lambda on a DynamoDB Streams trigger; under a least-privilege managed integration it's a scheduled Vercel function. The exactly-once guarantee is in the application logic, not the trigger.

*Built for the H0 Hackathon. #H0Hackathon*

---

## To deploy the live submission
Merge `feat/dsql-ledger` → `main` (auto-deploys to production). The DSQL + DynamoDB resources are shared across environments, so production reads the already-seeded data immediately. Verify production health, then submit the URL above.
