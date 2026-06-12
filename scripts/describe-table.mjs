import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: awsCredentialsProvider({
    roleArn: process.env.AWS_ROLE_ARN,
    clientConfig: { region: process.env.AWS_REGION },
  }),
})

const res = await client.send(
  new DescribeTableCommand({ TableName: process.env.DYNAMODB_TABLE_NAME }),
)
const t = res.Table
console.log(
  JSON.stringify(
    {
      name: t.TableName,
      keys: t.KeySchema,
      attrs: t.AttributeDefinitions,
      gsis: (t.GlobalSecondaryIndexes || []).map((g) => ({
        name: g.IndexName,
        keys: g.KeySchema,
        status: g.IndexStatus,
      })),
      billing: t.BillingModeSummary?.BillingMode,
      items: t.ItemCount,
    },
    null,
    2,
  ),
)
