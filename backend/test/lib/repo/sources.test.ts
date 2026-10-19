import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { SourcesRepo } from '../../../src/lib/repo/sources';
import type { Source } from '../../../src/lib/types';

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new SourcesRepo(ddb as unknown as DynamoDBDocumentClient, 'sources');

const src = (over: Partial<Source>): Source => ({
  sourceId: 'id',
  name: 'n',
  siteUrl: 'https://a.test',
  feedUrl: 'https://a.test/feed',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const ccf = () => new ConditionalCheckFailedException({ message: 'x', $metadata: {} });

beforeEach(() => ddb.reset());

describe('SourcesRepo', () => {
  it('list scans all pages and sorts by name case-insensitively', async () => {
    ddb
      .on(ScanCommand)
      .resolvesOnce({
        Items: [src({ name: 'banana' }), src({ name: 'Cherry' })],
        LastEvaluatedKey: { sourceId: 'x' },
      })
      .resolvesOnce({ Items: [src({ name: 'Apple' })] });
    const names = (await repo.list()).map((s) => s.name);
    expect(names).toEqual(['Apple', 'banana', 'Cherry']);
    expect(ddb.commandCalls(ScanCommand)[1].args[0].input.ExclusiveStartKey).toEqual({
      sourceId: 'x',
    });
  });

  it('get returns item or undefined', async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({ Item: src({}) })
      .resolvesOnce({});
    expect((await repo.get('id'))?.sourceId).toBe('id');
    expect(await repo.get('nope')).toBeUndefined();
  });

  it('findByFeedUrl matches normalized url', async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        src({ sourceId: 'a', feedUrl: 'https://a.test/feed?utm_source=x#top' }),
        src({ sourceId: 'b', feedUrl: 'https://b.test/feed' }),
      ],
    });
    expect((await repo.findByFeedUrl('https://a.test/feed'))?.sourceId).toBe('a');
    expect(await repo.findByFeedUrl('https://c.test/feed')).toBeUndefined();
  });

  it('create stores an enabled source with ulid and createdAt', async () => {
    ddb.on(PutCommand).resolves({});
    const s = await repo.create({
      name: 'N',
      siteUrl: 'https://a.test',
      feedUrl: 'https://a.test/feed',
    });
    expect(s.sourceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(s.enabled).toBe(true);
    expect(new Date(s.createdAt).toISOString()).toBe(s.createdAt);
    expect(ddb.commandCalls(PutCommand)[0].args[0].input.Item).toEqual(s);
  });

  it('update returns the updated source via ALL_NEW', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: src({ name: 'New' }) });
    const s = await repo.update('id', { name: 'New', enabled: false });
    expect(s?.name).toBe('New');
    const input = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.ConditionExpression).toBe('attribute_exists(sourceId)');
    expect(input.ReturnValues).toBe('ALL_NEW');
    expect(input.UpdateExpression).toBe('SET #name = :name, #enabled = :enabled');
    expect(input.ExpressionAttributeNames).toEqual({ '#name': 'name', '#enabled': 'enabled' });
  });

  it('update sets postsPerSource, or removes it on null', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: src({}) });
    await repo.update('id', { postsPerSource: 3 });
    await repo.update('id', { enabled: true, postsPerSource: null });
    const [set, clear] = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(set.UpdateExpression).toBe('SET #pps = :pps');
    expect(set.ExpressionAttributeValues).toEqual({ ':pps': 3 });
    expect(clear.UpdateExpression).toBe('SET #enabled = :enabled REMOVE #pps');
    expect(clear.ExpressionAttributeNames).toEqual({
      '#enabled': 'enabled',
      '#pps': 'postsPerSource',
    });
  });

  it('update with only a null override omits ExpressionAttributeValues', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: src({}) });
    await repo.update('id', { postsPerSource: null });
    const input = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toBe('REMOVE #pps');
    expect(input.ExpressionAttributeValues).toBeUndefined();
  });

  it('update on missing id → undefined', async () => {
    ddb.on(UpdateCommand).rejects(ccf());
    expect(await repo.update('nope', { name: 'x' })).toBeUndefined();
  });

  it('update with empty patch returns existing without UpdateItem', async () => {
    ddb.on(GetCommand).resolves({ Item: src({}) });
    expect((await repo.update('id', {}))?.sourceId).toBe('id');
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('remove returns true, or false when missing', async () => {
    ddb.on(DeleteCommand).resolvesOnce({}).rejectsOnce(ccf());
    expect(await repo.remove('id')).toBe(true);
    expect(await repo.remove('id')).toBe(false);
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input.ConditionExpression).toBe(
      'attribute_exists(sourceId)',
    );
  });

  it('recordCrawl ok removes lastError', async () => {
    ddb.on(UpdateCommand).resolves({});
    await repo.recordCrawl('id', { status: 'ok', newCount: 3, at: '2026-01-01T00:00:00.000Z' });
    const input = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toContain('REMOVE #le');
    expect(Object.values(input.ExpressionAttributeValues ?? {})).toEqual(
      expect.arrayContaining(['ok', 3, '2026-01-01T00:00:00.000Z']),
    );
  });

  it('recordCrawl error sets lastError truncated to 500 chars', async () => {
    ddb.on(UpdateCommand).resolves({});
    await repo.recordCrawl('id', { status: 'error', error: 'e'.repeat(900), newCount: 0, at: 't' });
    const input = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).not.toContain('REMOVE');
    expect(input.ConditionExpression).toBe('attribute_exists(sourceId)');
    expect(input.ExpressionAttributeNames?.['#le']).toBe('lastError');
    expect(input.ExpressionAttributeValues?.[':e']).toHaveLength(500);
  });

  it('recordCrawl on a deleted source resolves without throwing', async () => {
    ddb.on(UpdateCommand).rejects(ccf());
    await expect(
      repo.recordCrawl('gone', { status: 'ok', newCount: 0, at: 't' }),
    ).resolves.toBeUndefined();
  });

  it('recordCrawl rethrows other errors', async () => {
    ddb.on(UpdateCommand).rejects(new Error('boom'));
    await expect(repo.recordCrawl('id', { status: 'ok', newCount: 0, at: 't' })).rejects.toThrow(
      'boom',
    );
  });

  it('list tolerates an item with no name', async () => {
    ddb.on(ScanCommand).resolves({ Items: [{ sourceId: 'x' }, src({ name: 'A' })] });
    expect(await repo.list()).toHaveLength(2);
  });
});
