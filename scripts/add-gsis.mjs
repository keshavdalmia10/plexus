import {
  DynamoDBClient,
  UpdateTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

const TableName = process.env.DYNAMODB_TABLE_NAME

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: awsCredentialsProvider({
    roleArn: process.env.AWS_ROLE_ARN,
    clientConfig: { region: process.env.AWS_REGION },
  }),
})

async function waitForActive() {
  for (let i = 0; i < 60; i++) {
    const res = await client.send(new DescribeTableCommand({ TableName }))
    const allActive =
      res.Table.TableStatus === "ACTIVE" &&
      (res.Table.GlobalSecondaryIndexes || []).every(
        (g) => g.IndexStatus === "ACTIVE",
      )
    if (allActive) return res.Table
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error("Timed out waiting for table to become ACTIVE")
}

async function addGsi(indexName, pkAttr, skAttr) {
  const existing = await client.send(new DescribeTableCommand({ TableName }))
  if (
    (existing.Table.GlobalSecondaryIndexes || []).some(
      (g) => g.IndexName === indexName,
    )
  ) {
    console.log(`${indexName} already exists, skipping`)
    return
  }
  const attrs = [{ AttributeName: pkAttr, AttributeType: "S" }]
  const keySchema = [{ AttributeName: pkAttr, KeyType: "HASH" }]
  if (skAttr) {
    attrs.push({ AttributeName: skAttr, AttributeType: "S" })
    keySchema.push({ AttributeName: skAttr, KeyType: "RANGE" })
  }
  await client.send(
    new UpdateTableCommand({
      TableName,
      AttributeDefinitions: attrs,
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: indexName,
            KeySchema: keySchema,
            Projection: { ProjectionType: "ALL" },
          },
        },
      ],
    }),
  )
  console.log(`Creating ${indexName}...`)
  await waitForActive()
  console.log(`${indexName} ACTIVE`)
}

await addGsi("GSI1", "GSI1PK", "GSI1SK")
await addGsi("GSI2", "GSI2PK", "GSI2SK")
console.log("All GSIs ready")
