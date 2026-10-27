import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { subscriptionId, type PushSubscriptionRecord } from '../../../src/lib/push';
import { SubscriptionsRepo } from '../../../src/lib/repo/subscriptions';

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new SubscriptionsRepo(ddb as unknown as DynamoDBDocumentClient, 'subs');

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const rec = (id: string): PushSubscriptionRecord => ({
  id,
  endpoint: `https://fcm.googleapis.com/${id}`,
  p256dh: 'p',
  auth: 'a',
  createdAt: 't',
  updatedAt: 't',
});

beforeEach(() => ddb.reset());

describe('SubscriptionsRepo', () => {
  it('put upserts by endpoint hash, keeping the first createdAt', async () => {
    const id = subscriptionId(ENDPOINT);
    const stored = { ...rec(id), endpoint: ENDPOINT };
    ddb.on(UpdateCommand).resolves({ Attributes: stored });
    const now = new Date('2026-10-20T00:00:00.000Z');
    expect(await repo.put({ endpoint: ENDPOINT, p256dh: 'p', auth: 'a' }, now)).toEqual(stored);
    const input = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input).toMatchObject({
      TableName: 'subs',
      Key: { id },
      ReturnValues: 'ALL_NEW',
      ExpressionAttributeValues: {
        ':endpoint': ENDPOINT,
        ':p256dh': 'p',
        ':auth': 'a',
        ':now': '2026-10-20T00:00:00.000Z',
      },
    });
    expect(input.UpdateExpression).toContain('#createdAt = if_not_exists(#createdAt, :now)');
    expect(input.UpdateExpression).toContain('#updatedAt = :now');
  });

  it('put aliases every attribute name, since `auth` is a DynamoDB reserved word', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: {} });
    await repo.put({ endpoint: ENDPOINT, p256dh: 'p', auth: 'a' });
    const input = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ExpressionAttributeNames).toMatchObject({ '#auth': 'auth' });
    // Any identifier without a # or : prefix is a raw attribute name.
    const bare = input.UpdateExpression!.match(/(?<![#:\w])[A-Za-z_]\w*/g) ?? [];
    expect(bare.filter((w) => w !== 'SET' && w !== 'if_not_exists')).toEqual([]);
  });

  it('exists projects only the id', async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({ Item: { id: 'x' } })
      .resolvesOnce({});
    expect(await repo.exists('x')).toBe(true);
    expect(await repo.exists('y')).toBe(false);
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toMatchObject({
      TableName: 'subs',
      Key: { id: 'x' },
      ProjectionExpression: 'id',
    });
  });

  it('count sums COUNT scans across pages', async () => {
    ddb
      .on(ScanCommand)
      .resolvesOnce({ Count: 3, LastEvaluatedKey: { id: 'k' } })
      .resolvesOnce({ Count: 2 });
    expect(await repo.count()).toBe(5);
    const calls = ddb.commandCalls(ScanCommand);
    expect(calls[0].args[0].input).toMatchObject({ TableName: 'subs', Select: 'COUNT' });
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({ id: 'k' });
  });

  it('list scans all pages', async () => {
    ddb
      .on(ScanCommand)
      .resolvesOnce({ Items: [rec('a'), rec('b')], LastEvaluatedKey: { id: 'b' } })
      .resolvesOnce({ Items: [rec('c')] });
    expect((await repo.list()).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(ddb.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey).toEqual({ id: 'b' });
  });

  it('remove deletes by id', async () => {
    ddb.on(DeleteCommand).resolves({});
    await repo.remove('abc');
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input).toEqual({
      TableName: 'subs',
      Key: { id: 'abc' },
    });
  });
});
