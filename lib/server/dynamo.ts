import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { awsCredentialsProvider } from "@vercel/functions/oidc"

export const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME as string

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: awsCredentialsProvider({
    roleArn: process.env.AWS_ROLE_ARN as string,
    clientConfig: { region: process.env.AWS_REGION },
  }),
})

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

/* ---- Key builders (single-table design) ----------------------------------
 *
 * Distributor meta:  PK=DIST#<id>            SK=META
 * Volume aggregate:  PK=DIST#<id>            SK=VOLUME#<YYYY-MM>
 *
 * Tree index item:   PK=TREE                 SK=<path>          (subtree via begins_with)
 * Child edge item:   PK=PARENT#<parentId>    SK=<childId>       (direct children)
 *
 * The tree/parent items replace the originally planned GSI1/GSI2 — the
 * integration's IAM permissions boundary does not allow UpdateTable, so the
 * same access patterns are materialized as first-class items. No Scans, ever.
 * ------------------------------------------------------------------------ */

export const keys = {
  dist: (id: string) => `DIST#${id}`,
  meta: () => "META",
  volume: (period: string) => `VOLUME#${period}`,
  treePK: () => "TREE",
  parentPK: (parentId: string) => `PARENT#${parentId}`,
  systemPK: () => "SYSTEM",
  configPK: () => "CONFIG",
}
