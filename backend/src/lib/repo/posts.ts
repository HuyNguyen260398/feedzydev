import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { decodeCursor, encodeCursor } from '../cursor';
import type { Post } from '../types';

const BATCH_SIZE = 25;
const MAX_RETRIES = 3;

export class PostsRepo {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async exists(postId: string): Promise<boolean> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { postId }, ProjectionExpression: 'postId' }),
    );
    return res.Item !== undefined;
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
  }): Promise<{ items: Post[]; nextCursor?: string }> {
    const bySource = q.sourceId !== undefined;
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: bySource ? 'bySource' : 'byPublished',
        KeyConditionExpression: bySource ? 'sourceId = :s' : 'feedKey = :k',
        ExpressionAttributeValues: bySource ? { ':s': q.sourceId } : { ':k': 'ALL' },
        ScanIndexForward: false,
        Limit: q.limit,
        ...(q.cursor ? { ExclusiveStartKey: decodeCursor(q.cursor) } : {}),
      }),
    );
    return {
      items: (res.Items ?? []) as Post[],
      ...(res.LastEvaluatedKey ? { nextCursor: encodeCursor(res.LastEvaluatedKey) } : {}),
    };
  }

  async deleteBySource(sourceId: string): Promise<number> {
    const ids: string[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: 'bySource',
          KeyConditionExpression: 'sourceId = :s',
          ExpressionAttributeValues: { ':s': sourceId },
          ProjectionExpression: 'postId',
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) ids.push(item.postId as string);
      startKey = res.LastEvaluatedKey;
    } while (startKey);

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
            `Failed to delete ${left.length} unprocessed posts for source ${sourceId} after ${MAX_RETRIES} retries`,
          );
        }
        pending = { [this.table]: left };
      }
    }
    return ids.length;
  }
}
