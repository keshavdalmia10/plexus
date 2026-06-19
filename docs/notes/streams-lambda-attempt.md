# DynamoDB Streams + Lambda: feasibility under the Vercel↔AWS integration

**Date:** 2026-06-19 · **Phase:** 3 (Task 12)

## Goal
The spec's Phase 3 calls for the async propagation/health work to run on **AWS
Lambda triggered by DynamoDB Streams**. Enabling Streams on a table is a
`dynamodb:UpdateTable` operation, so that was the prerequisite we probed.

## What we attempted
Using the **same OIDC credential path the app uses** (Vercel OIDC token →
`awsCredentialsProvider` → assume `access-dynamodb-lime-engine`), we:
1. `DescribeTable` on `aws-dynamodb-lime-engine`
2. `UpdateTable` with `StreamSpecification { StreamEnabled: true, StreamViewType: NEW_AND_OLD_IMAGES }`

## Result (verbatim)
```
DescribeTable OK. StreamSpecification: "none"

UpdateTable (enable Streams) DENIED: AccessDeniedException
  message: User: arn:aws:sts::478728046454:assumed-role/access-dynamodb-lime-engine/aws-sdk-js-session-...
  is not authorized to perform: dynamodb:UpdateTable on resource:
  arn:aws:dynamodb:us-east-1:478728046454:table/aws-dynamodb-lime-engine
  because no permissions boundary allows the dynamodb:UpdateTable action
```

The integration-provisioned role can `DescribeTable`/`Query`/`GetItem`/`PutItem`/
`UpdateItem`/`TransactWriteItems` (everything the runtime needs) but its
**permissions boundary excludes `UpdateTable`**. This is the *same* boundary that
made GSI1/GSI2 impossible — documented in `lib/server/dynamo.ts` — and why the
hierarchy is materialized as first-class `TREE`/`PARENT#` items. It blocks
enabling Streams for the same reason.

## Decision: runtime-agnostic outbox + scheduled drainer (sanctioned fallback)
The **architecture is unchanged** — only the *trigger* differs:

| Concern | Unconstrained AWS account | This project (managed IAM boundary) |
|---|---|---|
| Reliable cross-store propagation | Transactional **outbox** | Transactional **outbox** (identical) |
| Exactly-once apply to DynamoDB | `TransactWriteItems` + idempotency marker | `TransactWriteItems` + idempotency marker (identical) |
| Drain trigger | **Lambda** on a DynamoDB Streams / SQS event | **Vercel Cron** (`vercel.json`, every minute) + inline fire-and-forget post-commit |

The outbox pattern is deliberately decoupled from its runner: `drainOutbox()` in
`lib/server/engine.ts` is the unit of work. It is invoked today by
`/api/jobs/drain-outbox` (cron-secured) and a fire-and-forget call after each sale.
Dropping it into a Lambda behind a Streams/SQS trigger would be a deployment change,
not a code change.

## README / video framing
State this plainly: *"In an unconstrained AWS account the drainer is a Lambda on a
Streams trigger; under the marketplace integration's least-privilege IAM boundary
(no `UpdateTable`), the identical outbox drainer runs as a scheduled Vercel function.
The exactly-once guarantee lives in the application logic, not the trigger."* This is
a strength — least-privilege by default — not a gap.
