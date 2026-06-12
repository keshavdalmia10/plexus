import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"
import { docClient, keys, TABLE_NAME } from "./dynamo"
import { putDistributor, recordSale } from "./repository"
import type { Distributor, Rank, SaleType } from "@/lib/types"

/* ------------------------------ tree shape ------------------------------- */

// parentId -> children ids. 40 distributors, max depth 6.
const TREE: Record<string, string[]> = {
  "001": ["002", "003", "004", "005"],
  "002": ["006", "007", "008"],
  "003": ["009", "010"],
  "004": ["011", "012", "013"],
  "005": ["014", "015"],
  "006": ["016", "017"],
  "007": ["018"],
  "009": ["019", "020"],
  "010": ["039", "040"],
  "011": ["021", "022"],
  "014": ["023", "024", "025"],
  "016": ["026", "027"],
  "019": ["028"],
  "021": ["029", "030"],
  "023": ["031", "032"],
  "027": ["033", "034"],
  "029": ["035"],
  "031": ["036"],
  "033": ["037"],
  "035": ["038"],
}

const NAMES: Record<string, string> = {
  "001": "Marta Reyes",
  "002": "Devon Carter",
  "003": "Priya Nair",
  "004": "Sam Okafor",
  "005": "Lena Vogel",
  "006": "Tom Ridley",
  "007": "Aisha Bello",
  "008": "Carl Jensen",
  "009": "Mina Park",
  "010": "Hugo Lindt",
  "011": "Rosa Delgado",
  "012": "Ken Watanabe",
  "013": "Nadia Saleh",
  "014": "Brent Holloway",
  "015": "Ines Costa",
  "016": "Yuki Tanaka",
  "017": "Omar Haddad",
  "018": "Greta Olsen",
  "019": "Felix Brand",
  "020": "Tara Quinn",
  "021": "Jorge Mena",
  "022": "Sofia Ricci",
  "023": "Dale Krantz",
  "024": "Petra Novak",
  "025": "Ravi Shah",
  "026": "Amara Diallo",
  "027": "Victor Crane",
  "028": "Lucy Tran",
  "029": "Mateo Silva",
  "030": "Hana Kim",
  "031": "Gus Werner",
  "032": "Dina Aziz",
  "033": "Reed Paxton",
  "034": "Olga Petrov",
  "035": "Ben Asante",
  "036": "Cleo Marsh",
  "037": "Ivan Doyle",
  "038": "Wendy Lau",
  "039": "Noor Khalid",
  "040": "Eli Stern",
}

// Subtrees that should be dominated by starter (sign-up) volume.
const STARTER_HEAVY_ROOTS = ["014", "027"]

const INACTIVE = new Set(["012", "020", "034", "038"])

const PRODUCTS = {
  retail: [
    { id: "PLX-VITA", amount: 64, volume: 50 },
    { id: "PLX-OMEGA", amount: 89, volume: 70 },
    { id: "PLX-GREENS", amount: 49, volume: 40 },
    { id: "PLX-PROTEIN", amount: 119, volume: 95 },
    { id: "PLX-SLEEP", amount: 54, volume: 42 },
    { id: "PLX-BUNDLE", amount: 179, volume: 140 },
  ],
  starter: [
    { id: "PLX-KIT-BASIC", amount: 299, volume: 200 },
    { id: "PLX-KIT-PRO", amount: 499, volume: 400 },
  ],
}

/* ----------------------------- deterministic rng ------------------------- */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* -------------------------------- seeding -------------------------------- */

let seededInProcess = false

/** Idempotent first-run seeding guarded by a conditional marker item. */
export async function ensureSeeded(): Promise<void> {
  if (seededInProcess) return
  const marker = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: keys.systemPK(), SK: "SEED" },
    }),
  )
  if (marker.Item) {
    seededInProcess = true
    return
  }
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: keys.systemPK(),
          SK: "SEED",
          startedAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    )
  } catch {
    // Another request claimed the seed; treat as seeded.
    seededInProcess = true
    return
  }
  console.log("[v0] Seeding Plexus demo data...")
  await seedDistributors()
  await seedSales()
  seededInProcess = true
  console.log("[v0] Seed complete")
}

function buildDistributors(): Distributor[] {
  const out: Distributor[] = []
  const walk = (id: string, parentId: string | null, parentPath: string) => {
    const path = parentPath ? `${parentPath}/${id}` : id
    const depth = path.split("/").length
    out.push({
      id,
      name: NAMES[id],
      parentId,
      path,
      depth,
      rank: rankFor(id, depth),
      status: INACTIVE.has(id) ? "inactive" : "active",
    })
    for (const child of TREE[id] ?? []) walk(child, id, path)
  }
  walk("001", null, "")
  return out
}

function rankFor(id: string, depth: number): Rank {
  if (id === "001") return "Diamond"
  if (depth === 2 && (TREE[id]?.length ?? 0) >= 2) return "Executive"
  const childCount = TREE[id]?.length ?? 0
  if (childCount >= 2) return "Director"
  if (childCount === 1) return "Builder"
  return "Associate"
}

async function seedDistributors(): Promise<void> {
  const distributors = buildDistributors()
  for (let i = 0; i < distributors.length; i += 5) {
    await Promise.all(distributors.slice(i, i + 5).map(putDistributor))
  }
}

async function seedSales(): Promise<void> {
  const rand = mulberry32(20260611)
  const distributors = buildDistributors()
  const active = distributors.filter((d) => d.status === "active")
  const starterHeavyIds = new Set(
    distributors
      .filter((d) =>
        STARTER_HEAVY_ROOTS.some(
          (r) => d.path.includes(`/${r}/`) || d.path.endsWith(`/${r}`) || d.id === r,
        ),
      )
      .map((d) => d.id),
  )

  const now = new Date()
  const sales: { distributorId: string; type: SaleType; at: Date }[] = []

  for (let i = 0; i < 150; i++) {
    const seller = active[Math.floor(rand() * active.length)]
    const starterBias = starterHeavyIds.has(seller.id) ? 0.8 : 0.04
    const type: SaleType = rand() < starterBias ? "starter" : "retail"
    // ~55% current month, ~45% previous month
    const monthOffset = rand() < 0.55 ? 0 : -1
    const base = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1),
    )
    const daysInMonth =
      monthOffset === 0
        ? Math.max(1, now.getUTCDate() - 1)
        : new Date(
            Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
          ).getUTCDate()
    const at = new Date(
      base.getTime() +
        Math.floor(rand() * daysInMonth) * 86_400_000 +
        Math.floor(rand() * 86_400_000),
    )
    sales.push({ distributorId: seller.id, type, at })
  }

  sales.sort((a, b) => a.at.getTime() - b.at.getTime())

  for (let i = 0; i < sales.length; i += 4) {
    await Promise.all(
      sales.slice(i, i + 4).map((s) => {
        const pool = PRODUCTS[s.type]
        const product = pool[Math.floor(rand() * pool.length)]
        return recordSale(
          {
            distributorId: s.distributorId,
            productId: product.id,
            amount: product.amount,
            volume: product.volume,
            type: s.type,
          },
          s.at,
        )
      }),
    )
  }
}
