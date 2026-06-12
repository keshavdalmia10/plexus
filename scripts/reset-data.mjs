import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME
const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: awsCredentialsProvider({
    roleArn: process.env.AWS_ROLE_ARN,
    clientConfig: { region: process.env.AWS_REGION },
  }),
})
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

let deleted = 0
let cursor
do {
  const page = await doc.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: "PK, SK",
      ExclusiveStartKey: cursor,
    }),
  )
  const items = page.Items ?? []
  for (let i = 0; i < items.length; i += 25) {
    const batch = items.slice(i, i + 25)
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((it) => ({
            DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
          })),
        },
      }),
    )
    deleted += batch.length
  }
  cursor = page.LastEvaluatedKey
} while (cursor)

console.log(`Deleted ${deleted} items from ${TABLE_NAME}`)
