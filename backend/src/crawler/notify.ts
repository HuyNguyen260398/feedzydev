import { mapWithConcurrency } from '../lib/pool';
import { buildPayload, type PushPayload, type PushSubscriptionRecord } from '../lib/push';
import type { SubscriptionsRepo } from '../lib/repo/subscriptions';
import type { Post } from '../lib/types';
import type { SourceResult } from './crawl';

/** Rejects with an error carrying the push service's `statusCode` when it answered. */
export type SendPush = (sub: PushSubscriptionRecord, payload: PushPayload) => Promise<void>;

export interface NotifyDeps {
  subscriptions: Pick<SubscriptionsRepo, 'list' | 'remove'>;
  sendPush: SendPush;
}

export const PUSH_CONCURRENCY = 10;
/** The push service says the subscription is gone for good. */
const GONE = new Set([404, 410]);

const totalNew = (results: SourceResult[]) => results.reduce((n, r) => n + r.newCount, 0);

/** Newest by publishedAt; ties keep the first in result order. */
function pickNewest(results: SourceResult[]): Post | undefined {
  let newest: Post | undefined;
  for (const r of results) {
    if (r.newest && (!newest || r.newest.publishedAt > newest.publishedAt)) newest = r.newest;
  }
  return newest;
}

export async function notifyNewPosts(
  deps: NotifyDeps,
  results: SourceResult[],
): Promise<{ sent: number; removed: number; failed: number }> {
  const counts = { sent: 0, removed: 0, failed: 0 };
  const newest = pickNewest(results);
  if (!newest) return counts;
  const subs = await deps.subscriptions.list();
  if (subs.length === 0) return counts;
  const payload = buildPayload(newest, totalNew(results));
  await mapWithConcurrency(subs, PUSH_CONCURRENCY, async (sub) => {
    try {
      await deps.sendPush(sub, payload);
      counts.sent++;
      return;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === undefined || !GONE.has(status)) {
        counts.failed++;
        return;
      }
    }
    try {
      await deps.subscriptions.remove(sub.id);
      counts.removed++;
    } catch {
      counts.failed++;
    }
  });
  return counts;
}

/** Only full runs that found new posts notify; push problems never fail the crawl. */
export async function notifyAfterCrawl(
  deps: NotifyDeps | null,
  event: { sourceId?: string },
  results: SourceResult[] | null,
): Promise<void> {
  if (event.sourceId || results === null || totalNew(results) === 0) return;
  if (!deps) {
    console.log(JSON.stringify({ msg: 'push.skipped', reason: 'push is not configured' }));
    return;
  }
  try {
    const summary = await notifyNewPosts(deps, results);
    console.log(JSON.stringify({ msg: 'push.summary', ...summary }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: 'push.failed', error }));
  }
}
