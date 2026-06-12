import {
  BatchGetCommand,
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"
import { nanoid } from "nanoid"
import { docClient, keys, TABLE_NAME } from "./dynamo"
import {
  COMMISSION_RATES,
  currentPeriod,
  type Distributor,
  type LedgerEntry,
  type Sale,
  type SaleType,
  type VolumeAggregate,
} from "@/lib/types"

/* ---------------------------------- reads -------------------------------- */

export async function getDistributor(id: string): Promise<Distributor | null> {
  const res = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: keys.dist(id), SK: keys.meta() },
    }),
  )
  return res.Item ? toDistributor(res.Item) : null
}

/** All distributors via the TREE partition (single Query, never a Scan). */
export async function getAllDistributors(): Promise<Distributor[]> {
  return querySubtree(undefined)
}

/** Subtree of a distributor (inclusive) via begins_with on the path. */
export async function getSubtree(path: string): Promise<Distributor[]> {
  return querySubtree(path)
}

async function querySubtree(pathPrefix?: string): Promise<Distributor[]> {
  const items: Record<string, unknown>[] = []
  let lastKey: Record<string, unknown> | undefined
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: pathPrefix
          ? "PK = :pk AND begins_with(SK, :path)"
          : "PK = :pk",
        ExpressionAttributeValues: pathPrefix
          ? { ":pk": keys.treePK(), ":path": pathPrefix }
          : { ":pk": keys.treePK() },
        ExclusiveStartKey: lastKey,
      }),
    )
    items.push(...(res.Items ?? []))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return items.map(toDistributor)
}

/** Direct children via the PARENT#<id> partition. */
export async function getDirectChildren(
  parentId: string,
): Promise<Distributor[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": keys.parentPK(parentId) },
    }),
  )
  return (res.Items ?? []).map(toDistributor)
}

export async function getVolume(
  id: string,
  period: string,
): Promise<VolumeAggregate> {
  const res = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: keys.dist(id), SK: keys.volume(period) },
    }),
  )
  return toVolume(id, period, res.Item)
}

/** Batch-read volume aggregates for many distributors in one period. */
export async function getVolumes(
  ids: string[],
  period: string,
): Promise<Map<string, VolumeAggregate>> {
  const out = new Map<string, VolumeAggregate>()
  for (const id of ids) out.set(id, toVolume(id, period, undefined))
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    let request: Record<string, { Keys: Record<string, string>[] }> = {
      [TABLE_NAME]: {
        Keys: chunk.map((id) => ({
          PK: keys.dist(id),
          SK: keys.volume(period),
        })),
      },
    }
    // Retry unprocessed keys until drained
    while (request[TABLE_NAME]?.Keys?.length) {
      const res = await docClient.send(
        new BatchGetCommand({ RequestItems: request }),
      )
      for (const item of res.Responses?.[TABLE_NAME] ?? []) {
        const id = String(item.PK).replace("DIST#", "")
        out.set(id, toVolume(id, period, item))
      }
      request = (res.UnprocessedKeys ?? {}) as typeof request
    }
  }
  return out
}

export async function getLedger(
  id: string,
  limit = 25,
): Promise<LedgerEntry[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": keys.dist(id),
        ":sk": "LEDGER#",
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  )
  return (res.Items ?? []).map((i) => ({
    txnId: String(i.txnId),
    beneficiaryId: id,
    sourceDistId: String(i.sourceDistId),
    sourceName: i.sourceName ? String(i.sourceName) : undefined,
    level: Number(i.level),
    amount: Number(i.amount),
    period: String(i.period),
    timestamp: String(i.timestamp),
  }))
}

/* --------------------------------- writes -------------------------------- */

/** Create a distributor: meta item + tree index item + parent edge item. */
export async function putDistributor(d: Distributor): Promise<void> {
  const meta = {
    PK: keys.dist(d.id),
    SK: keys.meta(),
    ...d,
  }
  const tree = { PK: keys.treePK(), SK: d.path, ...d }
  const requests: { PutRequest: { Item: Record<string, unknown> } }[] = [
    { PutRequest: { Item: meta } },
    { PutRequest: { Item: tree } },
  ]
  if (d.parentId) {
    requests.push({
      PutRequest: { Item: { PK: keys.parentPK(d.parentId), SK: d.id, ...d } },
    })
  }
  await docClient.send(
    new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: requests } }),
  )
}

export interface RecordSaleInput {
  distributorId: string
  productId: string
  amount: number
  volume: number
  type: SaleType
}

export interface RecordSaleResult {
  sale: Sale
  commissions: LedgerEntry[]
}

/**
 * Commission engine. Records the sale, increments the seller's volume
 * aggregate, rolls GV up the full ancestry chain, and pays commissions to
 * the nearest 5 upline members at 10/5/3/2/1%.
 */
export async function recordSale(
  input: RecordSaleInput,
  at: Date = new Date(),
): Promise<RecordSaleResult> {
  const seller = await getDistributor(input.distributorId)
  if (!seller) throw new Error(`Unknown distributor: ${input.distributorId}`)

  const iso = at.toISOString()
  const period = currentPeriod(at)
  const saleId = nanoid(10)

  const sale: Sale = {
    saleId,
    distributorId: seller.id,
    productId: input.productId,
    amount: round2(input.amount),
    volume: round2(input.volume),
    type: input.type,
    timestamp: iso,
  }

  // Ancestry, nearest first, excluding self.
  const ancestors = seller.path.split("/").slice(0, -1).reverse()

  const volumeField = input.type === "retail" ? "retailVolume" : "starterVolume"

  const writes: Promise<unknown>[] = [
    // Sale item
    docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: keys.dist(seller.id),
          SK: keys.sale(iso, saleId),
          ...sale,
        },
      }),
    ),
    // Seller volume aggregate: PV + GV + retail/starter split
    addToVolume(seller.id, period, {
      pv: sale.volume,
      gv: sale.volume,
      [volumeField]: sale.volume,
    }),
  ]

  const commissions: LedgerEntry[] = []

  ancestors.forEach((ancestorId, i) => {
    const updates: Record<string, number> = { gv: sale.volume }
    if (i < COMMISSION_RATES.length) {
      const commission = round2(sale.amount * COMMISSION_RATES[i])
      const txnId = nanoid(10)
      const entry: LedgerEntry = {
        txnId,
        beneficiaryId: ancestorId,
        sourceDistId: seller.id,
        sourceName: seller.name,
        level: i + 1,
        amount: commission,
        period,
        timestamp: iso,
      }
      commissions.push(entry)
      updates.commissionEarned = commission
      writes.push(
        docClient.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              PK: keys.dist(ancestorId),
              SK: keys.ledger(iso, txnId),
              ...entry,
            },
          }),
        ),
      )
    }
    writes.push(addToVolume(ancestorId, period, updates))
  })

  await Promise.all(writes)
  return { sale, commissions }
}

/** Atomic ADD upsert on a monthly volume aggregate item. */
function addToVolume(
  id: string,
  period: string,
  fields: Record<string, number>,
): Promise<unknown> {
  const names: Record<string, string> = {}
  const values: Record<string, number> = { ":zero": 0 }
  const sets: string[] = []
  Object.entries(fields).forEach(([field, value], i) => {
    names[`#f${i}`] = field
    values[`:v${i}`] = round2(value)
    sets.push(`#f${i} = if_not_exists(#f${i}, :zero) + :v${i}`)
  })
  return docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: keys.dist(id), SK: keys.volume(period) },
      UpdateExpression: `SET ${sets.join(", ")}, #did = :did, #period = :period`,
      ExpressionAttributeNames: {
        ...names,
        "#did": "distributorId",
        "#period": "period",
      },
      ExpressionAttributeValues: { ...values, ":did": id, ":period": period },
    }),
  )
}

/* --------------------------------- mappers ------------------------------- */

function toDistributor(item: Record<string, unknown>): Distributor {
  return {
    id: String(item.id),
    name: String(item.name),
    parentId: item.parentId ? String(item.parentId) : null,
    path: String(item.path),
    depth: Number(item.depth),
    rank: item.rank as Distributor["rank"],
    status: item.status as Distributor["status"],
  }
}

function toVolume(
  id: string,
  period: string,
  item: Record<string, unknown> | undefined,
): VolumeAggregate {
  return {
    distributorId: id,
    period,
    pv: Number(item?.pv ?? 0),
    gv: Number(item?.gv ?? 0),
    retailVolume: Number(item?.retailVolume ?? 0),
    starterVolume: Number(item?.starterVolume ?? 0),
    commissionEarned: Number(item?.commissionEarned ?? 0),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
