import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { fetchText } from '../lib/http';
import { PostsRepo } from '../lib/repo/posts';
import { SettingsRepo } from '../lib/repo/settings';
import { SourcesRepo } from '../lib/repo/sources';
import { crawlAll, type SourceResult } from './crawl';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(
  event: { sourceId?: string; scheduled?: boolean } = {},
): Promise<SourceResult[]> {
  const deps = {
    sources: new SourcesRepo(doc, process.env.SOURCES_TABLE ?? ''),
    posts: new PostsRepo(doc, process.env.POSTS_TABLE ?? ''),
    settings: new SettingsRepo(doc, process.env.SETTINGS_TABLE ?? ''),
    fetchText,
    now: () => new Date(),
  };
  const results = await crawlAll(deps, {
    sourceId: event?.sourceId,
    scheduled: event?.scheduled === true,
  });
  if (results === null) {
    console.log(JSON.stringify({ msg: 'crawl.skipped', reason: 'not a configured crawl hour' }));
    return [];
  }
  const totalNew = results.reduce((n, r) => n + r.newCount, 0);
  console.log(JSON.stringify({ msg: 'crawl.summary', results, totalNew }));
  return results;
}
