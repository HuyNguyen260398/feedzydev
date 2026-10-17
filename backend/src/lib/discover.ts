import { AppError } from './errors';
import { parseFeed } from './feed';
import { extractFeedLinks, extractPageMeta } from './html';
import type { FetchResult, FetchText } from './http';
import type { FeedCandidate, ParsedFeed } from './types';
import { normalizeUrl } from './url';

export const PROBE_PATHS = ['feed', 'feed/', 'rss', 'rss.xml', 'atom.xml', 'index.xml', 'feed.xml'];

const HOMEPAGE_TIMEOUT_MS = 8000;
const LINK_TIMEOUT_MS = 5000;
const MAX_URL_LENGTH = 2048;

interface Found {
  url: string;
  feed: ParsedFeed;
}

function assertValidUrl(input: string): URL {
  const invalid = new AppError(400, 'INVALID_URL', 'Enter a valid http(s) URL.');
  if (input.length > MAX_URL_LENGTH) throw invalid;
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw invalid;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw invalid;
  return u;
}

async function safeFetch(fetch: FetchText, url: string, timeoutMs: number) {
  try {
    return await fetch(url, { timeoutMs });
  } catch {
    return null;
  }
}

async function fetchFeed(fetch: FetchText, url: string): Promise<Found | null> {
  const res = await safeFetch(fetch, url, LINK_TIMEOUT_MS);
  if (!res || res.status < 200 || res.status >= 300) return null;
  const feed = parseFeed(res.body, res.url);
  return feed ? { url: res.url, feed } : null;
}

function looksLikeHtml(res: FetchResult): boolean {
  return (
    /html/i.test(res.contentType) || /<!doctype\s+html|<html[\s>]/i.test(res.body.slice(0, 2048))
  );
}

function dedupe(found: (Found | null)[]): Found[] {
  const seen = new Set<string>();
  const out: Found[] = [];
  for (const f of found) {
    if (!f) continue;
    const key = normalizeUrl(f.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function toCandidate(
  f: Found,
  pageUrl: string | undefined,
  origin: string,
  iconUrl?: string,
): FeedCandidate {
  return {
    feedUrl: f.url,
    title: f.feed.title || new URL(f.url).hostname,
    siteUrl: f.feed.siteUrl ?? pageUrl ?? origin,
    ...(iconUrl ? { iconUrl } : {}),
    preview: f.feed.entries.slice(0, 3).map((e) => ({
      title: e.title,
      ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
    })),
  };
}

export async function discoverFeeds(inputUrl: string, fetch: FetchText): Promise<FeedCandidate[]> {
  const input = assertValidUrl(inputUrl);
  const res = await safeFetch(fetch, inputUrl, HOMEPAGE_TIMEOUT_MS);

  if (res) {
    const direct = parseFeed(res.body, res.url);
    if (direct) return [toCandidate({ url: res.url, feed: direct }, undefined, input.origin)];
  }

  const isHtml = !!res && looksLikeHtml(res);
  const ok = !!res && res.status >= 200 && res.status < 300;
  const iconUrl = res && isHtml ? extractPageMeta(res.body, res.url).iconUrl : undefined;

  let found: Found[] = [];
  if (res && isHtml && ok) {
    const links = extractFeedLinks(res.body, res.url);
    found = dedupe(await Promise.all(links.map((l) => fetchFeed(fetch, l))));
  }

  if (found.length === 0) {
    const urls = new Set<string>();
    for (const p of PROBE_PATHS) {
      urls.add(new URL(p, inputUrl).toString());
    }
    for (const p of PROBE_PATHS) {
      urls.add(new URL('/' + p, input.origin).toString());
    }
    const probes = await Promise.all([...urls].map((u) => fetchFeed(fetch, u)));
    found = dedupe(probes).slice(0, 1);
  }

  return found.map((f) => toCandidate(f, inputUrl, input.origin, iconUrl));
}
