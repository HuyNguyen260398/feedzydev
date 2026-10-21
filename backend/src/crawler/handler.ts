import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import webpush from 'web-push';
import { fetchText } from '../lib/http';
import { PostsRepo } from '../lib/repo/posts';
import { SettingsRepo } from '../lib/repo/settings';
import { SourcesRepo } from '../lib/repo/sources';
import { SubscriptionsRepo } from '../lib/repo/subscriptions';
import { crawlAll, type SourceResult } from './crawl';
import { notifyAfterCrawl, type NotifyDeps } from './notify';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Null when VAPID keys or the table are not configured; the crawl then just logs push.skipped. */
function pushDeps(): NotifyDeps | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUBSCRIPTIONS_TABLE } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT || !SUBSCRIPTIONS_TABLE)
    return null;
  const vapidDetails = {
    subject: VAPID_SUBJECT,
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
  };
  return {
    subscriptions: new SubscriptionsRepo(doc, SUBSCRIPTIONS_TABLE),
    sendPush: async (sub, payload) => {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 86400, urgency: 'normal', vapidDetails },
      );
    },
  };
}

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
  // `newest` is only for the notification; keep the log and the return value as they were.
  const summary: SourceResult[] = results.map(({ sourceId, status, newCount, error }) => ({
    sourceId,
    status,
    newCount,
    ...(error ? { error } : {}),
  }));
  console.log(JSON.stringify({ msg: 'crawl.summary', results: summary, totalNew }));
  await notifyAfterCrawl(pushDeps(), event ?? {}, results);
  return summary;
}
