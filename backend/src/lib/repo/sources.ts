import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { normalizeUrl } from '../url';
import type { Source } from '../types';

const MAX_ERROR_LENGTH = 500;

export interface CrawlResult {
  status: 'ok' | 'error';
  error?: string;
  newCount: number;
  at: string;
}

export class SourcesRepo {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async list(): Promise<Source[]> {
    const items: Source[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new ScanCommand({ TableName: this.table, ExclusiveStartKey: startKey }),
      );
      items.push(...((res.Items ?? []) as Source[]));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items.sort((a, b) =>
      (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }),
    );
  }

  async get(id: string): Promise<Source | undefined> {
    const res = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { sourceId: id } }),
    );
    return res.Item as Source | undefined;
  }

  async findByFeedUrl(feedUrl: string): Promise<Source | undefined> {
    const target = normalizeUrl(feedUrl);
    return (await this.list()).find((s) => {
      try {
        return normalizeUrl(s.feedUrl) === target;
      } catch {
        return false;
      }
    });
  }

  async create(input: {
    name: string;
    siteUrl: string;
    feedUrl: string;
    iconUrl?: string;
  }): Promise<Source> {
    const source: Source = {
      sourceId: ulid(),
      name: input.name,
      siteUrl: input.siteUrl,
      feedUrl: input.feedUrl,
      ...(input.iconUrl ? { iconUrl: input.iconUrl } : {}),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    await this.doc.send(new PutCommand({ TableName: this.table, Item: source }));
    return source;
  }

  async update(
    id: string,
    patch: { name?: string; enabled?: boolean },
  ): Promise<Source | undefined> {
    const sets: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      sets.push('#name = :name');
      names['#name'] = 'name';
      values[':name'] = patch.name;
    }
    if (patch.enabled !== undefined) {
      sets.push('#enabled = :enabled');
      names['#enabled'] = 'enabled';
      values[':enabled'] = patch.enabled;
    }
    if (sets.length === 0) return this.get(id);
    try {
      const res = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { sourceId: id },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_exists(sourceId)',
          ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return res.Attributes as Source | undefined;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return undefined;
      throw e;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.doc.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { sourceId: id },
          ConditionExpression: 'attribute_exists(sourceId)',
        }),
      );
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }

  async recordCrawl(id: string, r: CrawlResult): Promise<void> {
    const values: Record<string, unknown> = {
      ':s': r.status,
      ':n': r.newCount,
      ':t': r.at,
    };
    const names: Record<string, string> = {
      '#ls': 'lastStatus',
      '#ln': 'lastNewCount',
      '#lc': 'lastCrawledAt',
      '#le': 'lastError',
    };
    let expr = 'SET #ls = :s, #ln = :n, #lc = :t';
    if (r.status === 'error') {
      expr += ', #le = :e';
      values[':e'] = (r.error ?? '').slice(0, MAX_ERROR_LENGTH);
    } else {
      expr += ' REMOVE #le';
    }
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { sourceId: id },
          UpdateExpression: expr,
          ConditionExpression: 'attribute_exists(sourceId)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return;
      throw e;
    }
  }
}
