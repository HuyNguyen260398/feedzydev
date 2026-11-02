import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { decodeCursor, encodeCursor } from '../cursor';
import { matchesSearch } from '../search';
import type { Post } from '../types';

const BATCH_SIZE = 25;
const MAX_RETRIES = 3;
/** Items read per query while searching, and the most read before handing back a cursor. */
const SEARCH_PAGE_SIZE = 200;
export const SEARCH_SCAN_LIMIT = 2000;

export class PostsRepo {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  /** A stored post's thumbnail state, or undefined when the post is not stored. */
  async find(postId: string): Promise<Pick<Post, 'thumbnailUrl'> | undefined> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.table,
        Key: { postId },
        ProjectionExpression: 'postId, thumbnailUrl',
      }),
    );
    if (!res.Item) return undefined;
    return res.Item.thumbnailUrl ? { thumbnailUrl: res.Item.thumbnailUrl as string } : {};
  }

  /** Fills in a missing thumbnail; a post purged or filled in meanwhile is left as it is. */
  async setThumbnail(postId: string, thumbnailUrl: string): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { postId },
          UpdateExpression: 'SET thumbnailUrl = :u',
          ConditionExpression: 'attribute_exists(postId) AND attribute_not_exists(thumbnailUrl)',
          ExpressionAttributeValues: { ':u': thumbnailUrl },
        }),
      );
    } catch (e) {
      if (!(e instanceof ConditionalCheckFailedException)) throw e;
    }
  }

  async putIfAbsent(post: Post): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: post,
          ConditionExpression: 'attribute_not_exists(postId)',
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }

  async listPage(q: {
    limit: number;
    cursor?: string;
    sourceId?: string;
    /** ISO timestamp; only posts published at or after it. */
    since?: string;
    /** Lower-cased terms that must all appear in the title or source name. */
    search?: string[];
    /** Searchable names by sourceId; a source not listed uses the name stored on the post. */
    sourceNames?: ReadonlyMap<string, string>;
  }): Promise<{ items: Post[]; nextCursor?: string }> {
    const bySource = q.sourceId !== undefined;
    const sinceCond = q.since !== undefined ? ' AND publishedAt >= :since' : '';
    const query = (limit: number, startKey?: Record<string, unknown>) =>
      this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: bySource ? 'bySource' : 'byPublished',
          KeyConditionExpression: (bySource ? 'sourceId = :s' : 'feedKey = :k') + sinceCond,
          ExpressionAttributeValues: {
            ...(bySource ? { ':s': q.sourceId } : { ':k': 'ALL' }),
            ...(q.since !== undefined ? { ':since': q.since } : {}),
          },
          ScanIndexForward: false,
          Limit: limit,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        }),
      );
    const startKey = q.cursor ? decodeCursor(q.cursor) : undefined;

    if (!q.search?.length) {
      const res = await query(q.limit, startKey);
      return {
        items: (res.Items ?? []) as Post[],
        ...(res.LastEvaluatedKey ? { nextCursor: encodeCursor(res.LastEvaluatedKey) } : {}),
      };
    }

    // DynamoDB has no substring index, so search walks the index newest-first and filters here.
    // A page can stop part-way through a query result; its cursor is then the last post's key.
    const terms = q.search;
    const keyOf = (p: Post) => ({
      postId: p.postId,
      publishedAt: p.publishedAt,
      ...(bySource ? { sourceId: p.sourceId } : { feedKey: p.feedKey }),
    });
    const items: Post[] = [];
    let key = startKey;
    let scanned = 0;
    for (;;) {
      const res = await query(SEARCH_PAGE_SIZE, key);
      const page = (res.Items ?? []) as Post[];
      for (let i = 0; i < page.length; i++) {
        if (!matchesSearch(page[i], terms, q.sourceNames?.get(page[i].sourceId))) continue;
        items.push(page[i]);
        if (items.length === q.limit) {
          const more = i < page.length - 1 || res.LastEvaluatedKey !== undefined;
          return { items, ...(more ? { nextCursor: encodeCursor(keyOf(page[i])) } : {}) };
        }
      }
      scanned += page.length;
      key = res.LastEvaluatedKey;
      if (!key) return { items };
      if (scanned >= SEARCH_SCAN_LIMIT) return { items, nextCursor: encodeCursor(key) };
    }
  }

  /** Deletes every post published before `cutoff` (ISO timestamp). */
  async deleteOlderThan(cutoff: string): Promise<number> {
    return this.deleteAll(
      await this.collectIds({
        IndexName: 'byPublished',
        KeyConditionExpression: 'feedKey = :k AND publishedAt < :cutoff',
        ExpressionAttributeValues: { ':k': 'ALL', ':cutoff': cutoff },
      }),
      'expired posts',
    );
  }

  async deleteBySource(sourceId: string): Promise<number> {
    return this.deleteAll(
      await this.collectIds({
        IndexName: 'bySource',
        KeyConditionExpression: 'sourceId = :s',
        ExpressionAttributeValues: { ':s': sourceId },
      }),
      `source ${sourceId}`,
    );
  }

  private async collectIds(query: {
    IndexName: string;
    KeyConditionExpression: string;
    ExpressionAttributeValues: Record<string, unknown>;
  }): Promise<string[]> {
    const ids: string[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          ...query,
          ProjectionExpression: 'postId',
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) ids.push(item.postId as string);
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return ids;
  }

  private async deleteAll(ids: string[], what: string): Promise<number> {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      let pending: Record<string, Record<string, unknown>[]> = {
        [this.table]: ids
          .slice(i, i + BATCH_SIZE)
          .map((postId) => ({ DeleteRequest: { Key: { postId } } })),
      };
      for (let attempt = 0; ; attempt++) {
        const res = await this.doc.send(new BatchWriteCommand({ RequestItems: pending }));
        const left = res.UnprocessedItems?.[this.table];
        if (!left || left.length === 0) break;
        if (attempt >= MAX_RETRIES) {
          throw new Error(
            `Failed to delete ${left.length} unprocessed posts for ${what} after ${MAX_RETRIES} retries`,
          );
        }
        pending = { [this.table]: left };
      }
    }
    return ids.length;
  }
}
