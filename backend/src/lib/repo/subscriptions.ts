import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { subscriptionId, type PushSubscriptionRecord } from '../push';

export class SubscriptionsRepo {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async exists(id: string): Promise<boolean> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { id }, ProjectionExpression: 'id' }),
    );
    return res.Item !== undefined;
  }

  async count(): Promise<number> {
    let total = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new ScanCommand({ TableName: this.table, Select: 'COUNT', ExclusiveStartKey: startKey }),
      );
      total += res.Count ?? 0;
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return total;
  }

  /** Idempotent upsert keyed by the endpoint hash; createdAt is kept from the first put. */
  async put(
    s: { endpoint: string; p256dh: string; auth: string },
    now = new Date(),
  ): Promise<PushSubscriptionRecord> {
    const res = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { id: subscriptionId(s.endpoint) },
        // `auth` is a DynamoDB reserved word, so every attribute goes through a #name.
        UpdateExpression:
          'SET #endpoint = :endpoint, #p256dh = :p256dh, #auth = :auth, #updatedAt = :now, ' +
          '#createdAt = if_not_exists(#createdAt, :now)',
        ExpressionAttributeNames: {
          '#endpoint': 'endpoint',
          '#p256dh': 'p256dh',
          '#auth': 'auth',
          '#updatedAt': 'updatedAt',
          '#createdAt': 'createdAt',
        },
        ExpressionAttributeValues: {
          ':endpoint': s.endpoint,
          ':p256dh': s.p256dh,
          ':auth': s.auth,
          ':now': now.toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return res.Attributes as PushSubscriptionRecord;
  }

  async remove(id: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { id } }));
  }

  async list(): Promise<PushSubscriptionRecord[]> {
    const items: PushSubscriptionRecord[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new ScanCommand({ TableName: this.table, ExclusiveStartKey: startKey }),
      );
      items.push(...((res.Items ?? []) as PushSubscriptionRecord[]));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
  }
}
