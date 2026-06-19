import { config } from "dotenv"
import { getPool } from "../lib/server/dsql"

config({ path: ".env.local" })

async function main() {
  const res = await getPool().query("SELECT 1 AS ok, current_database() AS db")
  console.log(res.rows)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
