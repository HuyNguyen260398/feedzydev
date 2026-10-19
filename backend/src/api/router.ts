import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AppError } from '../lib/errors';
import { parseFeed } from '../lib/feed';
import { discoverFeeds } from '../lib/discover';
import type { FetchText } from '../lib/http';
import type { PostsRepo } from '../lib/repo/posts';
import type { SettingsRepo } from '../lib/repo/settings';
import type { SourcesRepo } from '../lib/repo/sources';
import {
  CRAWL_TIMEZONE,
  MAX_POSTS_PER_SOURCE,
  MAX_RETENTION_DAYS,
  MIN_POSTS_PER_SOURCE,
  isValidHour,
  isValidPostsPerSource,
  isValidRetentionDays,
} from '../lib/settings';
import { MAX_SEARCH_LENGTH, searchTerms } from '../lib/search';
import type { PublicPost } from '../lib/types';
import { assertHttpUrl } from '../lib/url';
import { getOwnerEmail } from './auth';
import { fail, json } from './http';

export interface ApiDeps {
  sources: SourcesRepo;
  posts: PostsRepo;
  settings: SettingsRepo;
  fetchText: FetchText;
  invokeCrawl: (p: { sourceId?: string }) => Promise<void>;
  allowedEmail: string;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_NAME_LENGTH = 120;
const FEED_TIMEOUT_MS = 8000;

function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  if (!event.body) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function parseLimit(raw: string | undefined): number {
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function parseSince(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new AppError(400, 'INVALID_INPUT', 'since must be an ISO 8601 timestamp.');
  }
  // Normalise so it compares correctly against the stored ISO publishedAt strings.
  return new Date(ms).toISOString();
}

async function listPosts(event: APIGatewayProxyEvent, deps: ApiDeps) {
  const q = event.queryStringParameters ?? {};
  const since = parseSince(q.since);
  if (q.q !== undefined && q.q.length > MAX_SEARCH_LENGTH) {
    throw new AppError(400, 'INVALID_INPUT', `q must be at most ${MAX_SEARCH_LENGTH} characters.`);
  }
  const search = searchTerms(q.q);
  const page = await deps.posts.listPage({
    limit: parseLimit(q.limit),
    ...(q.cursor ? { cursor: q.cursor } : {}),
    ...(q.sourceId ? { sourceId: q.sourceId } : {}),
    ...(since ? { since } : {}),
    ...(search.length ? { search } : {}),
  });
  const items: PublicPost[] = page.items.map((p) => ({
    postId: p.postId,
    url: p.url,
    title: p.title,
    ...(p.author ? { author: p.author } : {}),
    publishedAt: p.publishedAt,
    ...(p.thumbnailUrl ? { thumbnailUrl: p.thumbnailUrl } : {}),
    sourceId: p.sourceId,
    sourceName: p.sourceName,
  }));
  return json(200, { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) });
}

async function listPublicSources(deps: ApiDeps) {
  const all = await deps.sources.list();
  const items = all
    .filter((s) => s.enabled)
    .map((s) => ({
      sourceId: s.sourceId,
      name: s.name,
      siteUrl: s.siteUrl,
      ...(s.iconUrl ? { iconUrl: s.iconUrl } : {}),
    }));
  return json(200, { items });
}

async function discover(event: APIGatewayProxyEvent, deps: ApiDeps) {
  const url = assertHttpUrl(parseBody(event).url);
  const candidates = await discoverFeeds(url, deps.fetchText);
  if (candidates.length === 0) {
    return fail(
      422,
      'NO_FEED_FOUND',
      'No RSS/Atom feed found at this URL — try pasting the feed URL directly.',
    );
  }
  return json(200, { candidates });
}

async function addSource(event: APIGatewayProxyEvent, deps: ApiDeps) {
  const body = parseBody(event);
  const feedUrl = assertHttpUrl(body.feedUrl);
  const iconUrl = body.iconUrl === undefined ? undefined : assertHttpUrl(body.iconUrl);
  if (await deps.sources.findByFeedUrl(feedUrl)) {
    return fail(409, 'DUPLICATE_SOURCE', 'This feed has already been added.');
  }
  const notAFeed = () => fail(422, 'NOT_A_FEED', 'That URL does not look like an RSS/Atom feed.');
  let res;
  try {
    res = await deps.fetchText(feedUrl, { timeoutMs: FEED_TIMEOUT_MS });
  } catch {
    return notAFeed();
  }
  const feed = res.status >= 200 && res.status < 300 ? parseFeed(res.body, res.url) : null;
  if (!feed) return notAFeed();

  const url = new URL(feedUrl);
  const given = typeof body.name === 'string' ? body.name.trim() : '';
  const name = (given || feed.title || url.hostname).slice(0, MAX_NAME_LENGTH);
  const source = await deps.sources.create({
    name,
    feedUrl,
    siteUrl: feed.siteUrl ?? url.origin,
    ...(iconUrl ? { iconUrl } : {}),
  });
  try {
    await deps.invokeCrawl({ sourceId: source.sourceId });
  } catch (err) {
    // The source exists; the next scheduled crawl will pick it up.
    console.error('invokeCrawl failed after create', err);
  }
  return json(201, source);
}

async function patchSource(event: APIGatewayProxyEvent, deps: ApiDeps, id: string) {
  const body = parseBody(event);
  const patch: { name?: string; enabled?: boolean; postsPerSource?: number | null } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      throw new AppError(400, 'INVALID_INPUT', 'name must be a non-empty string.');
    }
    patch.name = body.name.trim().slice(0, MAX_NAME_LENGTH);
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      throw new AppError(400, 'INVALID_INPUT', 'enabled must be a boolean.');
    }
    patch.enabled = body.enabled;
  }
  if (body.postsPerSource !== undefined) {
    if (body.postsPerSource !== null && !isValidPostsPerSource(body.postsPerSource)) {
      throw new AppError(400, 'INVALID_INPUT', POSTS_RANGE_MESSAGE);
    }
    patch.postsPerSource = body.postsPerSource;
  }
  const updated = await deps.sources.update(id, patch);
  if (!updated) return fail(404, 'NOT_FOUND', 'Source not found.');
  return json(200, updated);
}

const POSTS_RANGE_MESSAGE = `postsPerSource must be an integer from ${MIN_POSTS_PER_SOURCE} to ${MAX_POSTS_PER_SOURCE}.`;

async function getSettings(deps: ApiDeps) {
  return json(200, { ...(await deps.settings.get()), timezone: CRAWL_TIMEZONE });
}

async function putSettings(event: APIGatewayProxyEvent, deps: ApiDeps) {
  const body = parseBody(event);
  if (!isValidPostsPerSource(body.postsPerSource)) {
    throw new AppError(400, 'INVALID_INPUT', POSTS_RANGE_MESSAGE);
  }
  if (!Array.isArray(body.crawlHours) || !body.crawlHours.every(isValidHour)) {
    throw new AppError(400, 'INVALID_INPUT', 'crawlHours must be a list of hours from 0 to 23.');
  }
  if (!isValidRetentionDays(body.retentionDays)) {
    throw new AppError(
      400,
      'INVALID_INPUT',
      `retentionDays must be an integer from 0 (keep forever) to ${MAX_RETENTION_DAYS}.`,
    );
  }
  const crawlHours = [...new Set(body.crawlHours as number[])].sort((a, b) => a - b);
  const saved = await deps.settings.put({
    postsPerSource: body.postsPerSource,
    crawlHours,
    retentionDays: body.retentionDays,
  });
  return json(200, { ...saved, timezone: CRAWL_TIMEZONE });
}

async function deleteSource(deps: ApiDeps, id: string) {
  if (!(await deps.sources.get(id))) return fail(404, 'NOT_FOUND', 'Source not found.');
  await deps.posts.deleteBySource(id);
  await deps.sources.remove(id);
  return json(204);
}

async function routeAdmin(
  event: APIGatewayProxyEvent,
  deps: ApiDeps,
  method: string,
  path: string,
): Promise<APIGatewayProxyResult> {
  if (path === '/admin/sources') {
    if (method === 'GET') return json(200, { items: await deps.sources.list() });
    if (method === 'POST') return addSource(event, deps);
  } else if (path === '/admin/settings') {
    if (method === 'GET') return getSettings(deps);
    if (method === 'PUT') return putSettings(event, deps);
  } else if (path === '/admin/sources/discover') {
    if (method === 'POST') return discover(event, deps);
  } else if (path === '/admin/crawl') {
    if (method === 'POST') {
      const sourceId = parseBody(event).sourceId;
      if (sourceId !== undefined && (typeof sourceId !== 'string' || sourceId === '')) {
        throw new AppError(400, 'INVALID_INPUT', 'sourceId must be a non-empty string.');
      }
      await deps.invokeCrawl(sourceId === undefined ? {} : { sourceId });
      return json(202, { status: 'started' });
    }
  } else {
    const m = /^\/admin\/sources\/([^/]+)$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (method === 'PATCH') return patchSource(event, deps, id);
      if (method === 'DELETE') return deleteSource(deps, id);
    }
  }
  return fail(404, 'NOT_FOUND', 'Not found.');
}

export async function route(
  event: APIGatewayProxyEvent,
  deps: ApiDeps,
): Promise<APIGatewayProxyResult> {
  try {
    const method = event.httpMethod;
    const path = event.path.length > 1 ? event.path.replace(/\/+$/, '') : event.path;

    if (path === '/admin' || path.startsWith('/admin/')) {
      const owner = getOwnerEmail(event, deps.allowedEmail);
      if (owner === 'none') return fail(401, 'UNAUTHORIZED', 'Sign in required.');
      if (owner === 'forbidden') return fail(403, 'FORBIDDEN', 'This app is private.');
      return await routeAdmin(event, deps, method, path);
    }
    if (method === 'GET' && path === '/posts') return await listPosts(event, deps);
    if (method === 'GET' && path === '/sources') return await listPublicSources(deps);
    return fail(404, 'NOT_FOUND', 'Not found.');
  } catch (err) {
    if (err instanceof AppError) return fail(err.status, err.code, err.message);
    console.error(err);
    return fail(500, 'INTERNAL', 'Internal server error.');
  }
}
