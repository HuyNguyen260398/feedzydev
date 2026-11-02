import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { decodeCursor } from '../../../src/lib/cursor';
import { PostsRepo, SEARCH_SCAN_LIMIT } from '../../../src/lib/repo/posts';
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
};

beforeEach(() => ddb.reset());

describe('PostsRepo', () => {
  it('find returns only the stored thumbnail state, or undefined when absent', async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({ Item: { postId: 'p1', thumbnailUrl: 'https://img.io/a.png' } })
      .resolvesOnce({ Item: { postId: 'p2' } })
      .resolvesOnce({});
    expect(await repo.find('p1')).toEqual({ thumbnailUrl: 'https://img.io/a.png' });
    expect(await repo.find('p2')).toEqual({});
    expect(await repo.find('p3')).toBeUndefined();
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toMatchObject({
      TableName: 'posts',
      Key: { postId: 'p1' },
      ProjectionExpression: 'postId, thumbnailUrl',
    });
  });

  it('setThumbnail only fills in a missing thumbnail on a post that still exists', async () => {
    ddb.on(UpdateCommand).resolves({});
    await repo.setThumbnail('p1', 'https://img.io/a.png');
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input).toMatchObject({
      TableName: 'posts',
      Key: { postId: 'p1' },
      UpdateExpression: 'SET thumbnailUrl = :u',
      ConditionExpression: 'attribute_exists(postId) AND attribute_not_exists(thumbnailUrl)',
      ExpressionAttributeValues: { ':u': 'https://img.io/a.png' },
    });
  });

  it('setThumbnail ignores a post that was purged or already has a thumbnail', async () => {
    ddb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'x', $metadata: {} }));
    await expect(repo.setThumbnail('p1', 'https://img.io/a.png')).resolves.toBeUndefined();
  });

  it('setThumbnail rethrows other errors', async () => {
    ddb.on(UpdateCommand).rejects(new Error('boom'));
    await expect(repo.setThumbnail('p1', 'https://img.io/a.png')).rejects.toThrow('boom');
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

  it('listPage since adds a publishedAt key condition on either index', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await repo.listPage({ limit: 10, since: '2026-10-10T00:00:00.000Z' });
    await repo.listPage({ limit: 10, sourceId: 's1', since: '2026-10-10T00:00:00.000Z' });
    const [global, bySource] = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
    expect(global.KeyConditionExpression).toBe('feedKey = :k AND publishedAt >= :since');
    expect(global.ExpressionAttributeValues).toEqual({
      ':k': 'ALL',
      ':since': '2026-10-10T00:00:00.000Z',
    });
    expect(bySource.KeyConditionExpression).toBe('sourceId = :s AND publishedAt >= :since');
    expect(bySource.ExpressionAttributeValues?.[':s']).toBe('s1');
  });

  describe('listPage search', () => {
    const mk = (i: number, title: string, sourceName = 'Blog'): Post => ({
      ...post,
      postId: `p${i}`,
      title,
      sourceName,
      publishedAt: `2026-01-${String(30 - i).padStart(2, '0')}T00:00:00.000Z`,
    });

    it('filters titles and source names case-insensitively across query pages', async () => {
      ddb
        .on(QueryCommand)
        .resolvesOnce({
          Items: [mk(1, 'Kubernetes 1.36'), mk(2, 'Terraform'), mk(3, 'Misc', 'K8s KUBERNETES')],
          LastEvaluatedKey: { k: 1 },
        })
        .resolvesOnce({ Items: [mk(4, 'kubernetes again')] });
      const page = await repo.listPage({ limit: 10, search: ['kubernetes'] });
      expect(page.items.map((p) => p.postId)).toEqual(['p1', 'p3', 'p4']);
      expect(page.nextCursor).toBeUndefined();
      const inputs = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
      expect(inputs[0].Limit).toBe(200);
      expect(inputs[1].ExclusiveStartKey).toEqual({ k: 1 });
    });

    it('searches the current names of a source instead of the name stored on the post', async () => {
      ddb.on(QueryCommand).resolves({
        Items: [
          { ...mk(1, 'a', 'Old Name'), sourceId: 'renamed' },
          { ...mk(2, 'b', 'Old Name'), sourceId: 'deleted' },
        ],
      });
      const sourceNames = new Map([['renamed', 'Kubernetes Blog\nK8s']]);
      const hit = async (term: string) =>
        (await repo.listPage({ limit: 10, search: [term], sourceNames })).items.map(
          (p) => p.postId,
        );
      expect(await hit('k8s')).toEqual(['p1']);
      expect(await hit('kubernetes')).toEqual(['p1']);
      // A source that no longer exists falls back to the name on the post.
      expect(await hit('old')).toEqual(['p2']);
    });

    it('requires every term to match', async () => {
      ddb.on(QueryCommand).resolves({
        Items: [mk(1, 'Kubernetes upgrades'), mk(2, 'Kubernetes', 'Upgrades Weekly'), mk(3, 'x')],
      });
      const page = await repo.listPage({ limit: 10, search: ['kubernetes', 'upgrades'] });
      expect(page.items.map((p) => p.postId)).toEqual(['p1', 'p2']);
    });

    it('stops at limit mid-page with a cursor at the last returned post', async () => {
      ddb.on(QueryCommand).resolves({ Items: [mk(1, 'a'), mk(2, 'a'), mk(3, 'a')] });
      const page = await repo.listPage({ limit: 2, search: ['a'] });
      expect(page.items).toHaveLength(2);
      expect(decodeCursor(page.nextCursor as string)).toEqual({
        postId: 'p2',
        publishedAt: '2026-01-28T00:00:00.000Z',
        feedKey: 'ALL',
      });
    });

    it('a by-source cursor uses the bySource key; no cursor when the last item fills the page', async () => {
      ddb
        .on(QueryCommand)
        .resolvesOnce({ Items: [mk(1, 'a'), mk(2, 'b')], LastEvaluatedKey: { k: 1 } });
      const page = await repo.listPage({ limit: 1, sourceId: 's1', search: ['a'] });
      expect(decodeCursor(page.nextCursor as string)).toEqual({
        postId: 'p1',
        publishedAt: '2026-01-29T00:00:00.000Z',
        sourceId: 's1',
      });
      ddb.reset();
      ddb.on(QueryCommand).resolves({ Items: [mk(1, 'b'), mk(2, 'a')] });
      expect((await repo.listPage({ limit: 1, search: ['a'] })).nextCursor).toBeUndefined();
    });

    it('hands back a cursor after scanning the limit without filling the page', async () => {
      const miss = Array.from({ length: 200 }, (_, i) => mk(i, 'nope'));
      ddb.on(QueryCommand).resolves({ Items: miss, LastEvaluatedKey: { k: 'last' } });
      const page = await repo.listPage({ limit: 5, search: ['zzz'] });
      expect(page.items).toEqual([]);
      expect(decodeCursor(page.nextCursor as string)).toEqual({ k: 'last' });
      expect(ddb.commandCalls(QueryCommand)).toHaveLength(SEARCH_SCAN_LIMIT / 200);
    });
  });

  it('deleteOlderThan deletes posts published before the cutoff', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ postId: 'p0' }, { postId: 'p1' }] });
    ddb.on(BatchWriteCommand).resolves({});
    expect(await repo.deleteOlderThan('2026-09-17T00:00:00.000Z')).toBe(2);
    const input = ddb.commandCalls(QueryCommand)[0].args[0].input;
    expect(input).toMatchObject({
      IndexName: 'byPublished',
      KeyConditionExpression: 'feedKey = :k AND publishedAt < :cutoff',
      ExpressionAttributeValues: { ':k': 'ALL', ':cutoff': '2026-09-17T00:00:00.000Z' },
      ProjectionExpression: 'postId',
    });
    expect(ddb.commandCalls(BatchWriteCommand)[0].args[0].input.RequestItems?.posts).toHaveLength(
      2,
    );
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
