import { postIdFor } from '../lib/url';
import type { FeedEntry, Post, Source } from '../lib/types';

export const MAX_AGE_DAYS = 14;
export const RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/** The newest `limit` valid entries, newest first. */
export function toPosts(entries: FeedEntry[], source: Source, now: Date, limit: number): Post[] {
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const out: Post[] = [];
  for (const entry of entries) {
    if (!entry.url || !entry.publishedAt) continue;
    let publishedMs = Date.parse(entry.publishedAt);
    if (Number.isNaN(publishedMs)) continue;
    if (publishedMs < nowMs - MAX_AGE_DAYS * DAY_MS) continue;
    if (publishedMs > nowMs + DAY_MS) continue;
    if (publishedMs > nowMs) publishedMs = nowMs;
    let postId: string;
    try {
      postId = postIdFor(entry.url);
    } catch {
      continue;
    }
    if (seen.has(postId)) continue;
    seen.add(postId);
    out.push({
      postId,
      url: entry.url,
      title: entry.title,
      ...(entry.author ? { author: entry.author } : {}),
      publishedAt: new Date(publishedMs).toISOString(),
      ...(entry.thumbnailUrl ? { thumbnailUrl: entry.thumbnailUrl } : {}),
      sourceId: source.sourceId,
      sourceName: source.name,
      feedKey: 'ALL',
      crawledAt: now.toISOString(),
      expiresAt: Math.floor(publishedMs / 1000) + RETENTION_DAYS * 86400,
    });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
}
