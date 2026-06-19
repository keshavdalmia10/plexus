import { Pool } from "pg"
import { DsqlSigner } from "@aws-sdk/dsql-signer"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

// No top-level env validation or signer construction — this module is
// transitively imported by pure unit tests where .env.local is not loaded.
// Everything env-dependent lives inside getPool() so importing is always safe.
let pool: Pool | undefined

/** Lazy singleton — IAM token fetched per new connection (tokens expire ~15min). */
export function getPool(): Pool {
  if (pool) return pool
  const host = process.env.AWS_REGION_PGHOST ?? ""
  const region = process.env.AWS_REGION ?? process.env.AWS_REGION_AWS_REGION ?? ""
  const roleArn = process.env.AWS_REGION_AWS_ROLE_ARN as string
  if (!host) throw new Error("AWS_REGION_PGHOST (DSQL endpoint) is not set")

  const signer = new DsqlSigner({
    hostname: host,
    region,
    credentials: awsCredentialsProvider({
      roleArn,
      clientConfig: { region },
    }),
  })

  pool = new Pool({
    host,
    port: Number(process.env.AWS_REGION_PGPORT ?? 5432),
    database: process.env.AWS_REGION_PGDATABASE ?? "postgres",
    user: process.env.AWS_REGION_PGUSER ?? "admin",
    // admin user → admin connect token
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
