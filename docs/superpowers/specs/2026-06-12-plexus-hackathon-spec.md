# Plexus — Real-Time Network Commission Engine (H0 Hackathon Build Spec)

> Hackathon: H0 — Hack the Zero Stack with Vercel v0 + AWS Databases
> Track: Track 1 — Monetizable B2C App. Deadline: Jun 29, 2026 @ 5:00pm PDT.
> One-line: real-time distributed commission engine for network-based direct-sales,
> DynamoDB single-table unbounded-depth referral network + atomic upline volume rollup.

NOTE: This file is the user-provided spec, condensed only where prose repeats; all
normative requirements preserved. Decisions made with the user on 2026-06-12:
1. Aurora DSQL provisioned via Vercel Marketplace AWS integration.
2. Phase-3 async compute: attempt Lambda+Streams, fall back to Vercel cron worker.
3. Keep existing TREE/PARENT materialized index items instead of GSI1/GSI2
   (integration IAM boundary blocks UpdateTable); document the deviation.

## Scoring context
Judges: 7 AWS database architects. Score dominated by data-model quality. The
differentiator is POLYGLOT persistence: DynamoDB single table for the network +
Aurora DSQL for the ACID commission ledger, with a reliable cross-store write path.
Phase 1+2 = complete submittable app. Phase 3 = differentiator. Phase 4 = artifacts.
Build depth-first in phase order; every Acceptance block is a hard gate.

## Product
B2C consumer SaaS for an individual seller (their income/network cockpit). Models:
referral network (unbounded-depth tree), sales (manual "record a sale" demo action),
unilevel compensation paying up the ancestry chain, live earnings dashboard +
genealogy view, network-health view (retail vs sign-up volume), freemium Free/Pro.
Copy rules: first-person seller framing; lead with retail selling, never recruiting;
never use the words "MLM" or "pyramid" (risk view is "Network Health").

## Tech stack (fixed)
Next.js App Router + TS + Tailwind on Vercel; Route Handlers for API;
DynamoDB (single table, on-demand) = network graph + read models;
Aurora DSQL = sales + commission ledger, ACID, system of record;
AWS Lambda + DynamoDB Streams (Phase 3) for derived health rollups / outbox drain;
SDK v3 (lib-dynamodb: TransactWrite/Query/Get); pg driver + parameterized SQL for DSQL;
SSE or 2s polling (no websockets); demo seller switcher (no real auth);
lightweight tree renderer + recharts; creds via Vercel env / OIDC; repo public, no secrets.

### Why two databases (verbatim in README + video)
DynamoDB owns the network: deep hierarchy queried by access pattern (subtree, front
line, own aggregates) — single-table + materialized path serves each in O(1)/O(items),
no joins/scans; SQL recursive CTEs degrade. Aurora DSQL owns the money: commissions
must be correct under concurrency — atomic multi-row writes, strong consistency,
auditable SQL (statements, joins, reconciliation); eventually-consistent counters are
unacceptable for a ledger. Strong consistency where money requires it, access-pattern
denormalized reads where the network requires it, reliable propagation between them.

## Data model — DynamoDB (table `Plexus`, PK/SK, on-demand, stream NEW_AND_OLD_IMAGES in P3)
Principles: materialized path `001/014/207` (subtree = begins_with; upline = parse,
free); co-location of a seller's aggregates under PK=DIST#<id>.
Items:
- Seller:   PK=DIST#<id> SK=META {name,email,parentId,sponsorId,path,depth,rank,status,plan}
- Volume:   PK=DIST#<id> SK=VOLUME#<YYYY-MM> {pv,gv,retailVolume,starterVolume,commissionEarned,period,updatedAt}
- Health:   PK=DIST#<id> SK=HEALTH#<YYYY-MM> {recruitmentRatio,healthScore,flaggedCount,updatedAt} (Phase-3 Lambda)
- Plan cfg: PK=CONFIG SK=PLAN {planType,levelRates[],maxDepth}
- Rank cfg: PK=CONFIG SK=RANK#<order> {rankName,minGv,minPv,order}
Sales and ledger are NOT DynamoDB items — they live in DSQL.
Tree access (as-built deviation): GSI1(TREE/path) and GSI2(PARENT#) are replaced by
first-class items PK=TREE SK=<path> and PK=PARENT#<parentId> SK=<childId>.

### Access patterns (README + video must show this table)
1 Get seller profile — DDB GetItem(DIST#id, META)
2 Direct children — DDB Query(PARENT#id)
3 Full downline subtree — DDB Query(TREE, begins_with(SK, node.path))
4 Upline ancestors — parse path, no DB call
5 Current-period earnings/volume — DDB GetItem(DIST#id, VOLUME#period)
6 Network-health rollup — DDB GetItem(DIST#id, HEALTH#period)
7 Plan + ranks — DDB Query(PK=CONFIG)
8 Record sale + pay upline — DSQL ACID txn: insert sale + N ledger rows
9 Commission feed — DSQL SELECT … WHERE beneficiary_id=$1 ORDER BY created_at DESC
10 Monthly statement / reconciliation — DSQL aggregate/join over ledger + sales
RULE: zero DynamoDB Scan operations anywhere.

## Data model — Aurora DSQL
```sql
CREATE TABLE sales (
  sale_id UUID PRIMARY KEY, seller_id TEXT NOT NULL, product_id TEXT,
  amount NUMERIC(12,2) NOT NULL, volume NUMERIC(12,2) NOT NULL,
  sale_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE ledger (
  txn_id TEXT PRIMARY KEY,           -- deterministic hash(sale_id+beneficiary_id)
  sale_id UUID NOT NULL REFERENCES sales(sale_id),
  beneficiary_id TEXT NOT NULL, source_id TEXT NOT NULL, level INT NOT NULL,
  amount NUMERIC(12,2) NOT NULL, period TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_ledger_beneficiary ON ledger(beneficiary_id, created_at DESC);
-- Phase 3: transactional outbox
CREATE TABLE outbox (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type TEXT NOT NULL, payload JSONB NOT NULL, processed_at TIMESTAMPTZ);
```
(Adapt DDL to real DSQL limitations as needed; deterministic txn_id = idempotency;
sale + all ledger rows commit in ONE transaction — partial payout impossible.)

## Commission logic + cross-store write path
Config: unilevel, levelRates=[0.10,0.05,0.03,0.02,0.01], maxDepth=5.
On sale volume V by seller D (path a/b/c/D):
1. Resolve upline from DDB META path — no traversal. 2. Levels nearest-first;
commission = V * levelRates[k-1]. 3. ONE DSQL ACID txn: INSERT sale + N ledger rows
(txn_id deterministic) + (P3) outbox row; COMMIT. 4. Propagate to DDB: atomic ADD
to each beneficiary VOLUME gv/commissionEarned; seller pv + retail/starter split.
Consistency model (say in video): DSQL ledger = source of truth (ACID); DDB
aggregates = derived read model, eventually consistent, rebuildable from ledger.
Phase 2: step 4 synchronous after commit. Phase 3: transactional outbox + worker.
Rank computed lazily on read from RANK#* thresholds; never stored/synced.

## Network health (must-have)
P2: on request Query subtree + volumes, compute live. P3: precomputed HEALTH#period
read-model item maintained async. recruitmentRatio = Σstarter/(Σretail+Σstarter);
healthy <0.4, watch 0.4–0.7, flagged >0.7; heatmap + headline score (100 − ratio·100).

## API surface
POST /api/sales (engine; body {sellerId,productId?,amount,volume,type});
GET /api/sellers/[id] (profile+volume+rank); /children; /downline (plan-gated depth);
/ledger (DSQL feed); /health (Pro-gated, teaser/402 for Free);
POST /api/billing/upgrade (mock checkout flips plan);
GET /api/stream/[id] (SSE, P3; polling fallback);
POST /api/seed (dev-only, guarded). All typed, zod-validated, no Scan, parameterized SQL.
(As-built: routes live under /api/distributors/* — keep, document mapping.)

## Frontend screens
Top bar (plan badge, upgrade CTA, small "acting as" switcher);
Dashboard (PV/GV/Rank/Earnings cards, live ledger feed, Record-a-sale action);
Network view (collapsible tree; Free = levels 1–3, deeper blurred + upgrade overlay);
Network Health (Pro-only; Free teaser w/ blurred score);
Pricing (Free vs Pro $12/mo; mock upgrade unlocks instantly, no reload).
Hero demo flow: Free seller records deep sale → upline earnings tick live in order →
health paywall → upgrade → instant unlock.

## Seed
~40 sellers depth 5–6 branching 2–4, mixed plans, CONFIG items, VOLUME aggregates;
DSQL: ~80 historical sales across current+previous periods, retail+starter mixed,
≥2 flagged subtrees, ledger rows generated. Idempotent (deterministic ids /
ON CONFLICT DO NOTHING). DDB aggregates must reconcile with DSQL ledger after seeding.

## Phases + acceptance gates
P1 Data layer: DSQL provision + schema; clients; key/path helpers; seed both stores.
  ACCEPT: all 10 access patterns runnable vs real stores; zero Scans; ledger sums == DDB aggregates.
P2 Engine + APIs + UI + monetization: ACID sale write w/ idempotent txn_id; sync
  propagate; reads (DDB network / DSQL ledger); API-level gating; mock upgrade; polling.
  ACCEPT: deep sale → correct ledger rows in ONE txn (forced mid-txn failure leaves
  zero rows); correct upline aggregates; dashboard reflects within one poll; Free
  blocked at API; upgrade unlocks instantly. Complete submittable app.
P3 Outbox + Streams + Lambda: outbox row in sale txn; worker drains → DDB updates;
  Streams→Lambda recomputes HEALTH rollups (fallback: Vercel cron); SSE.
  ACCEPT: ledger+outbox commit together; propagation survives app crash mid-request;
  health rollups async; graceful degradation if worker down.
P4 Artifacts: README (access-pattern table, why-two-DBs verbatim, single-table
  explainer, consistency model, setup, diagram); public repo MIT, no creds;
  live Vercel URL + Team ID; architecture diagram (AWS icons; Browser→Vercel→
  DSQL+DDB; outbox→Lambda→DDB; Streams→Lambda→HEALTH); storage screenshots proving
  BOTH DBs; 3–5min video (lead with data model/architecture, then live demo +
  monetization beat); bonus dev.to/LinkedIn post tagged #H0Hackathon.

## Out of scope
Real auth, real payments, storefront/catalog, admin/settings, mobile, multi-tenant,
any Scan-based feature.

## Conventions
TS strict, no any; zod inputs; one DDB client singleton; all access via typed
repository layer; keys via helpers only; idempotent writes; atomic ADD counters;
never read-modify-write a counter; no secrets in repo.

## Monetization
Free: dashboard, record sales, feed, network levels 1–3, health teaser.
Pro $12/mo: full network depth, full health analytics. Engine pays all 5 levels for
everyone (gate views only). plan on META item; gate in API layer (teaser/402);
mock checkout flips plan, immediate unlock. One-sentence pitch, no TAM slides.
Seller earns via retail sales (primary) + downline override commissions (secondary
amplifier); recruitment itself pays nothing; Network Health flags recruitment-heavy
subtrees. App = income tracker + growth tool, not point of sale.
