import { parseFeed } from '../lib/feed';
import { extractPageMeta } from '../lib/html';
import { FetchError, type FetchText } from '../lib/http';
import { mapWithConcurrency } from '../lib/pool';
import type { PostsRepo } from '../lib/repo/posts';
import type { SettingsRepo } from '../lib/repo/settings';
import type { SourcesRepo } from '../lib/repo/sources';
import { DEFAULT_SETTINGS, localHour } from '../lib/settings';
import type { Settings, Source } from '../lib/types';
import { toPosts } from './entries';

export interface CrawlDeps {
  sources: Pick<SourcesRepo, 'list' | 'get' | 'recordCrawl'>;
  posts: Pick<PostsRepo, 'exists' | 'putIfAbsent'>;
  settings: Pick<SettingsRepo, 'get'>;
  fetchText: FetchText;
  now: () => Date;
}

export interface SourceResult {
  sourceId: string;
  status: 'ok' | 'error';
  newCount: number;
  error?: string;
}

export const OG_FETCH_BUDGET = 30;
export const SOURCE_CONCURRENCY = 5;

function describeError(err: unknown): string {
  if (err instanceof FetchError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

async function crawlInner(
  source: Source,
  deps: CrawlDeps,
  budget: { og: number },
  now: Date,
  limit: number,
): Promise<number> {
  const res = await deps.fetchText(source.feedUrl, { timeoutMs: 10000 });
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  const feed = parseFeed(res.body, source.feedUrl);
  if (!feed) throw new Error('Not a valid feed');

  let newCount = 0;
  for (const post of toPosts(feed.entries, source, now, limit)) {
    if (await deps.posts.exists(post.postId)) continue;
    if (!post.thumbnailUrl && budget.og > 0) {
      budget.og--;
      try {
        const page = await deps.fetchText(post.url, { timeoutMs: 5000 });
        if (page.status >= 200 && page.status < 300) {
          const og = extractPageMeta(page.body, post.url).ogImage;
          if (og) post.thumbnailUrl = og;
        }
      } catch {
        // og:image is best-effort
      }
    }
    if (await deps.posts.putIfAbsent(post)) newCount++;
  }
  return newCount;
}

export async function crawlSource(
  source: Source,
  deps: CrawlDeps,
  budget: { og: number },
  settings: Settings = DEFAULT_SETTINGS,
): Promise<SourceResult> {
  const now = deps.now();
  const limit = source.postsPerSource ?? settings.postsPerSource;
  let result: SourceResult;
  try {
    const newCount = await crawlInner(source, deps, budget, now, limit);
    result = { sourceId: source.sourceId, status: 'ok', newCount };
  } catch (err) {
    result = {
      sourceId: source.sourceId,
      status: 'error',
      newCount: 0,
      error: describeError(err),
    };
  }
  try {
    await deps.sources.recordCrawl(source.sourceId, {
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
      newCount: result.newCount,
      at: now.toISOString(),
    });
  } catch (err) {
    console.error(`recordCrawl failed for ${source.sourceId}: ${describeError(err)}`);
  }
  return result;
}

async function loadSettings(deps: CrawlDeps): Promise<Settings> {
  try {
    return await deps.settings.get();
  } catch (err) {
    // A settings outage should not stop crawling; fall back to the defaults.
    console.error(`settings.get failed: ${describeError(err)}`);
    return DEFAULT_SETTINGS;
  }
}

/**
 * `scheduled` runs come from the hourly ticker and only crawl during a configured hour;
 * manual and per-source runs always crawl. Returns null when a scheduled run is skipped.
 */
export async function crawlAll(
  deps: CrawlDeps,
  opts: { sourceId?: string; scheduled?: boolean },
): Promise<SourceResult[] | null> {
  const settings = await loadSettings(deps);
  if (opts.scheduled && !settings.crawlHours.includes(localHour(deps.now()))) return null;
  const budget = { og: OG_FETCH_BUDGET };
  if (opts.sourceId) {
    const source = await deps.sources.get(opts.sourceId);
    return source ? [await crawlSource(source, deps, budget, settings)] : [];
  }
  const sources = (await deps.sources.list()).filter((s) => s.enabled);
  return mapWithConcurrency(sources, SOURCE_CONCURRENCY, (s) =>
    crawlSource(s, deps, budget, settings),
  );
}
