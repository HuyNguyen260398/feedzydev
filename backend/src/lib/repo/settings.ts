import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_SETTINGS } from '../settings';
import type { Settings } from '../types';

const KEY = { id: 'global' };

export class SettingsRepo {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  /** Stored settings, with defaults filled in for anything never saved. */
  async get(): Promise<Settings> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table, Key: KEY }));
    const item = (res.Item ?? {}) as Partial<Settings>;
    return {
      postsPerSource: item.postsPerSource ?? DEFAULT_SETTINGS.postsPerSource,
      crawlHours: item.crawlHours ?? DEFAULT_SETTINGS.crawlHours,
      retentionDays: item.retentionDays ?? DEFAULT_SETTINGS.retentionDays,
      ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
    };
  }

  async put(settings: Settings): Promise<Settings> {
    const saved: Settings = { ...settings, updatedAt: new Date().toISOString() };
    await this.doc.send(new PutCommand({ TableName: this.table, Item: { ...KEY, ...saved } }));
    return saved;
  }
}
