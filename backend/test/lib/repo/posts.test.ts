import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { decodeCursor } from '../../../src/lib/cursor';
import { PostsRepo } from '../../../src/lib/repo/posts';
import type { Post } from '../../../src/lib/types';

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new PostsRepo(ddb as unknown as DynamoDBDocumentClient, 'posts');

const post: Post = {
  postId: 'p1',
  url: 'https://a.test/1',
  title: 't',
  publishedAt: '2026-01-01T00:00:00.000Z',
  sourceId: 's1',
  sourceName: 'S',
  feedKey: 'ALL',
  crawledAt: '2026-01-02T00:00:00.000Z',
  expiresAt: 1,
};

beforeEach(() => ddb.reset());

describe('PostsRepo', () => {
  it('exists reflects Get result', async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({ Item: { postId: 'p1' } })
      .resolvesOnce({});
    expect(await repo.exists('p1')).toBe(true);
    expect(await repo.exists('p2')).toBe(false);
  });

  it('putIfAbsent sends conditional put', async () => {
    ddb.on(PutCommand).resolves({});
    expect(await repo.putIfAbsent(post)).toBe(true);
    const input = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(input.ConditionExpression).toBe('attribute_not_exists(postId)');
    expect(input.TableName).toBe('posts');
    expect(input.Item).toEqual(post);
  });

  it('putIfAbsent returns false when the post exists', async () => {
    ddb
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'x', $metadata: {} }));
    expect(await repo.putIfAbsent(post)).toBe(false);
  });

  it('putIfAbsent rethrows other errors', async () => {
    ddb.on(PutCommand).rejects(new Error('boom'));
    await expect(repo.putIfAbsent(post)).rejects.toThrow('boom');
  });

  it('listPage global uses byPublished newest-first', async () => {
    const lek = { postId: 'p', feedKey: 'ALL', publishedAt: 't' };
    ddb.on(QueryCommand).resolves({ Items: [post], LastEvaluatedKey: lek });
    const page = await repo.listPage({ limit: 30 });
    const input = ddb.commandCalls(QueryCommand)[0].args[0].input;
    expect(input).toMatchObject({ IndexName: 'byPublished', ScanIndexForward: false, Limit: 30 });
    expect(input.ExpressionAttributeValues?.[':k']).toBe('ALL');
    expect(input.ExclusiveStartKey).toBeUndefined();
    expect(page.items).toEqual([post]);
    expect(decodeCursor(page.nextCursor as string)).toEqual(lek);

    await repo.listPage({ limit: 30, cursor: page.nextCursor });
    expect(ddb.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(lek);
  });

  it('listPage omits nextCursor on the last page', async () => {
    ddb.on(QueryCommand).resolves({ Items: [post] });
    expect((await repo.listPage({ limit: 5 })).nextCursor).toBeUndefined();
  });

  it('listPage by source uses bySource', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await repo.listPage({ limit: 10, sourceId: 's1' });
    const input = ddb.commandCalls(QueryCommand)[0].args[0].input;
    expect(input).toMatchObject({ IndexName: 'bySource', ScanIndexForward: false, Limit: 10 });
    expect(input.ExpressionAttributeValues?.[':s']).toBe('s1');
  });

  it('deleteBySource batches by 25', async () => {
    const items = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ postId: `p${from + i}` }));
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: items(0, 20), LastEvaluatedKey: { postId: 'p19' } })
      .resolvesOnce({ Items: items(20, 10) });
    ddb.on(BatchWriteCommand).resolves({});
    expect(await repo.deleteBySource('s1')).toBe(30);
    const calls = ddb.commandCalls(BatchWriteCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.RequestItems?.posts).toHaveLength(25);
    expect(calls[1].args[0].input.RequestItems?.posts).toHaveLength(5);
  });

  it('deleteBySource retries unprocessed items', async () => {
    const unprocessed = { posts: [{ DeleteRequest: { Key: { postId: 'p0' } } }] };
    ddb.on(QueryCommand).resolves({ Items: [{ postId: 'p0' }, { postId: 'p1' }] });
    ddb.on(BatchWriteCommand).resolvesOnce({ UnprocessedItems: unprocessed }).resolvesOnce({});
    expect(await repo.deleteBySource('s1')).toBe(2);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(2);
  });

  it('deleteBySource throws if items stay unprocessed after 3 retries', async () => {
    const unprocessed = { posts: [{ DeleteRequest: { Key: { postId: 'p0' } } }] };
    ddb.on(QueryCommand).resolves({ Items: [{ postId: 'p0' }] });
    ddb.on(BatchWriteCommand).resolves({ UnprocessedItems: unprocessed });
    await expect(repo.deleteBySource('s1')).rejects.toThrow(/unprocessed/i);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(4);
  });
});
