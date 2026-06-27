# Plexus — Devpost Submission

*Real-time commission engine for direct-sales sellers, built on a deliberate two-database split: Amazon DynamoDB for the network, Aurora DSQL for the money.*

**Live:** https://plexus-commission-dashboard-f1.vercel.app
**Hackathon:** H0 — Hack the Zero Stack with Vercel v0 + AWS Databases · Track 1, Monetizable B2C

---

![The Plexus dashboard](https://raw.githubusercontent.com/keshavdalmia10/plexus/main/docs/images/dashboard.png)
*The live income cockpit. Sales volume, network volume, rank, and earnings update in real time, with a running feed of every downline sale that paid you.*

## Inspiration

If you've ever sold for a direct-sales brand, you know the frustrating part isn't the selling. It's that you can't see your own money. Your commissions come from a network of people below you, and the tools batch all of that into a statement that lands once a month, long after any of it is useful. By the time you find out a whole branch of your network went quiet, it's been quiet for weeks.

We wanted the opposite of a monthly PDF. Record a sale, watch the earnings move up the chain in real time, see exactly where every dollar came from.

The other half of the inspiration was the judging. This hackathon is scored by AWS database architects, and the prompt is "Vercel v0 + AWS databases." That reframed the whole thing for us. The win condition isn't UI breadth, it's the data model. So we asked a sharper question: what *is* a referral commission engine, underneath? And the answer is that it's two different problems wearing one trenchcoat. A network is a graph you query by shape. Money is a ledger you have to get exactly right under concurrency. Those two things want different databases. That tension became the whole project.

The original move here isn't the product category. Side-hustle commission tracking exists. It's the architecture. We treat a referral engine as a *polyglot-persistence* problem: one app that's secretly two database problems, with an exactly-once bridge between them. On a prompt where most entries are a single store behind a v0 UI, the idea is building the *seam* between two AWS databases and proving it holds.

## What it does

Plexus is the income cockpit for one individual seller.

- **Live dashboard** — your sales volume, network volume, rank, and earnings, updating in real time over SSE. A running commission feed shows every sale below you that paid you, and at which level.
- **Record a sale** — posts to the commission engine, which pays the upline 5 levels at 10/5/3/2/1%. Watch the numbers tick. We even let the rank recompute live, so a sale can bump you from Director to Executive on screen.
- **Network view** — your whole downline as a tree, with per-person volume and rank.
- **Network Health** — scores how much of your network's volume is genuine retail versus sign-up packs, and flags branches where starter kits dominate. This is the "is my network real or is it just recruiting" view.
- **Freemium** — Free gets the dashboard, the feed, and three levels of network. Pro ($12/mo) unlocks the full network depth and Health analytics. Gating is enforced at the API, not just hidden in the UI.

![Network view, gated on the Free plan](https://raw.githubusercontent.com/keshavdalmia10/plexus/main/docs/images/network-gated.png)
*The network tree on Free. You see three levels; the rest sits behind an upgrade prompt. The gate is enforced server-side, not just blurred in the UI.*

![Network Health paywall](https://raw.githubusercontent.com/keshavdalmia10/plexus/main/docs/images/health-paywall.png)
*Network Health is a Pro feature: the score is teased behind a paywall.*

![Network Health unlocked](https://raw.githubusercontent.com/keshavdalmia10/plexus/main/docs/images/health-unlocked.png)
*After upgrading: the full health score, retail-vs-starter split, and every flagged branch.*


![Pricing](https://raw.githubusercontent.com/keshavdalmia10/plexus/main/docs/images/pricing.png)
*Freemium done honestly: $0 Free vs $12/mo Pro, with a demo checkout that collects no payment.*

## How we built it

The core decision: **polyglot persistence, one truth.**

- **Amazon DynamoDB owns the network.** A single-table design with a materialized path (`001/014/207`). That one string encodes the entire upline, so resolving who gets paid is a string split, not a database call. A subtree is one `begins_with` query. Direct children are one partition lookup. No joins, no recursive CTEs, and the rule we held to the whole way: zero table scans, anywhere.
- **Aurora DSQL owns the money.** The sale and all of its commission rows commit in a single ACID transaction. A partial payout is impossible. Deterministic transaction IDs (`hash(saleId + beneficiaryId)`) make the write idempotent, so a retried request can't double-pay.
- **A transactional outbox bridges them.** The outbox row commits inside the same DSQL transaction as the money. A drainer then applies the derived aggregates to DynamoDB exactly-once, using `TransactWriteItems` with a conditional idempotency marker. DSQL is the source of truth. The DynamoDB aggregates are a rebuildable read model, and we have a `reconcile.ts` script that proves zero drift between them.

![Architecture](https://raw.githubusercontent.com/keshavdalmia10/plexus/main/docs/images/architecture.png)
*The full flow: a sale commits money plus an outbox row to Aurora DSQL in one transaction (1), a drainer polls the outbox (2) and applies aggregates to DynamoDB exactly-once via an EVENT# idempotency marker (3). Reads come straight off DynamoDB; live updates stream back over SSE.*

The app is Next.js on Vercel, scaffolded with v0. Auth to AWS is Vercel's OIDC federation, so there are no static AWS keys anywhere in the repo. We shipped it as 18 reviewed tasks behind two acceptance gates: a Phase-B gate (7 checks: atomicity, idempotency, the 5-level cascade, API gating, statement math, reconciliation) and a Phase-C gate (5 checks: outbox atomicity, crash survival, exactly-once apply, health rollups, graceful degradation). 19 unit tests on top.

## Design

We didn't want a back-end with a UI bolted on top. The front-end is built to surface exactly what the two databases produce, so the layers read as one thing.

- The **commission feed** is the Aurora DSQL ledger, made visible. Every row is a real ledger entry, shown at the level it paid.
- The **network tree** is the DynamoDB materialized path, rendered. The shape on screen is the shape in the table.
- The **live earnings tick** is the transactional outbox propagating, in real time. Record a downline sale and you watch the number move and the rank recompute, because that's the read model catching up in front of you.
- The **paywall is honest.** The locked network levels and the blurred Health score aren't a CSS trick, they're the API refusing to send the data. The teaser is real, which is why the unlock feels real.

Visually it stays quiet on purpose: clean cards, one green accent, generous spacing, no dashboard clutter fighting for attention. The seller sees their money, their network, and their health, and nothing else. That's the full-stack point. The design decisions and the data decisions are the same decisions.

## Challenges we ran into

This is where the project got interesting, because almost every challenge came from reality pushing back.

**The IAM wall.** We designed the hierarchy around two GSIs. Then provisioning failed, because the managed Vercel-to-AWS integration hands you a least-privilege role, and that role's permissions boundary excludes `dynamodb:UpdateTable`. No GSIs. And later, no DynamoDB Streams either, for the same reason. We confirmed it with the actual `AccessDeniedException`. So we materialized the two indexes as first-class items in the table (`TREE` and `PARENT#`), which serves the exact same access patterns, and we ran the outbox drainer as a Vercel Cron plus an inline trigger instead of a Lambda on a Streams event. The drainer logic is identical either way. We decided to treat the constraint as part of the story rather than something to apologize for.

**Aurora DSQL is not vanilla Postgres.** It's distributed SQL, and it tells you so the moment you run the spec's DDL. No foreign keys. No sequences or `GENERATED AS IDENTITY`. `CREATE INDEX` has to be `CREATE INDEX ASYNC`. You can't put `DESC` in an index key. We adapted the schema and documented every deviation.

**The serverless bug that passed every local test.** Our drainer fired as `void drainOutbox()` after the response. Locally it worked perfectly. Every acceptance gate was green. We deployed, walked through the live demo, and the earnings just... didn't move. It turns out Vercel freezes the function instance the moment the response is sent, so a fire-and-forget after the response never runs. Local Node keeps the process alive, which is exactly why local lied to us. 53 events had quietly piled up undrained in production while the money in DSQL was perfectly correct. The fix was Vercel's `waitUntil()`, which keeps the instance alive until the drain finishes. We only caught this because we tested the real deployment, not localhost.

**The self-reseeding gremlin.** While recording the demo, the numbers kept climbing on their own. We chased it for a while convinced something was double-applying. The real cause: our reseed wiped the "already seeded" marker but never recreated it, so the next page load triggered the app's first-run auto-seed and it cheerfully re-seeded itself with 150 more sales. Classic. One missing `PutItem` was the whole bug.

## Accomplishments that we're proud of

- **Exactly-once across two databases, and we can prove it.** Apply-first, mark-second, with an idempotency marker that survives crashes and concurrent drainers. The reconcile script shows zero drift across 36 beneficiary-periods.
- **Zero scans.** Every one of the ten access patterns is a `GetItem` or a `Query` on a key. We never reached for a `Scan`, not even in the wipe-and-reseed tooling.
- **We turned constraints into the pitch.** Least-privilege IAM with no `UpdateTable` is the *correct* posture for a managed integration. Naming it, and showing the same access patterns served by first-class items, is a stronger story than pretending we had unconstrained access.
- **We caught bugs that only production could show us.** The `waitUntil` issue and the self-reseed both would have shipped silently if we'd trusted the green checkmarks. Testing the live deploy paid for itself.

## What we learned

- **Local green is not production green.** Serverless changes the rules for anything that happens after the response. If your design relies on background work, you have to verify it on the real platform, because the local process model will quietly cover for you.
- **Choose the database per access pattern, not per habit.** A graph queried by shape and a ledger that has to be correct under concurrency are not the same problem. One source of truth (DSQL), one rebuildable read model (DynamoDB), a reliable path between them. That sentence is the whole architecture.
- **Constraints are content.** The IAM boundary and the DSQL quirks felt like roadblocks in the moment. In the writeup and the demo, they're the most credible parts, because they show we actually ran this against real managed services and dealt with what they hand you.

## Impact and real-world fit

The audience is real and underserved. Millions of people run direct-sales side hustles, and the tooling they get is a statement once a month. Plexus gives that person something they've never really had: their income and their network, live.

What makes it more than a demo is the infrastructure under it. DynamoDB serves an unbounded-depth network with no table scans, so it doesn't buckle when a downline grows into the thousands. Aurora DSQL keeps the money correct under concurrency, which is non-negotiable the second you're touching payouts. Those aren't demo conveniences, they're the choices you'd make to actually ship this to a real seller base. And the freemium model is a working monetization path, not a slide: the individual seller pays for visibility into their own business.

So it's not just functional. It's shaped like something you could put in front of real users on Monday and trust to hold up as the data grows.

## What's next for Plexus

- **Real billing.** The Pro upgrade is a mock checkout today. Wire up Stripe.
- **Real sales ingestion.** Replace "record a sale" with an import from Shopify, Square, or a CSV, so the engine tracks income a seller actually earned rather than a demo button.
- **Lambda + Streams in an unconstrained account.** The drainer is deliberately runtime-agnostic. In an AWS account without the managed permissions boundary, it drops straight onto a DynamoDB Streams or SQS trigger with no code change.
- **Operational polish.** TTL the `EVENT#` idempotency markers so they don't accumulate, add rank-up notifications, and build out multi-period statement history on top of the DSQL ledger.
- **Make the Network Health view actionable.** Right now it flags recruitment-heavy branches. Next it should tell the seller what to do about them.
