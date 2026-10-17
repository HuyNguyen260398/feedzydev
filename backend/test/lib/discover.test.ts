import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverFeeds } from '../../src/lib/discover';
import { AppError } from '../../src/lib/errors';
import { FetchError, type FetchText } from '../../src/lib/http';

const feedXml = readFileSync(join(__dirname, '../fixtures/rss2-media.xml'), 'utf8');
type Map = Record<string, { status?: number; body: string; contentType?: string }>;
const fake =
  (map: Map): FetchText =>
  async (url) => {
    const hit = map[url];
    if (!hit) return { status: 404, url, contentType: 'text/html', body: 'not found' };
    return {
      status: hit.status ?? 200,
      url,
      contentType: hit.contentType ?? 'text/html',
      body: hit.body,
    };
  };
const xml = { body: feedXml, contentType: 'application/rss+xml' };
const page = (links: string) => ({
  body: `<html><head><link rel="icon" href="/i.ico">${links}</head><body></body></html>`,
});
const alt = (h: string) => `<link rel="alternate" type="application/rss+xml" href="${h}">`;

test('direct feed URL → one candidate with preview of 3', async () => {
  const r = await discoverFeeds('https://a.io/feed', fake({ 'https://a.io/feed': xml }));
  expect(r).toHaveLength(1);
  expect(r[0].feedUrl).toBe('https://a.io/feed');
  expect(r[0].title).toBe('Example DevOps Blog');
  expect(r[0].preview).toHaveLength(3);
});

test('homepage advertising two feeds → both', async () => {
  const r = await discoverFeeds(
    'https://a.io/',
    fake({
      'https://a.io/': page(alt('/f1') + alt('/f2')),
      'https://a.io/f1': xml,
      'https://a.io/f2': xml,
    }),
  );
  expect(r.map((c) => c.feedUrl)).toEqual(['https://a.io/f1', 'https://a.io/f2']);
  expect(r[0].iconUrl).toBe('https://a.io/i.ico');
});

test('advertised link that is not a feed is excluded', async () => {
  const r = await discoverFeeds(
    'https://a.io/',
    fake({
      'https://a.io/': page(alt('/f1') + alt('/bad')),
      'https://a.io/f1': xml,
      'https://a.io/bad': { body: '<html></html>' },
    }),
  );
  expect(r.map((c) => c.feedUrl)).toEqual(['https://a.io/f1']);
});

test('probes paths when nothing advertised', async () => {
  const r = await discoverFeeds(
    'https://site.dev/blog/',
    fake({ 'https://site.dev/blog/': page(''), 'https://site.dev/blog/rss.xml': xml }),
  );
  expect(r.map((c) => c.feedUrl)).toEqual(['https://site.dev/blog/rss.xml']);
});

test('falls back to site-root probes', async () => {
  const r = await discoverFeeds(
    'https://site.dev/blog/',
    fake({ 'https://site.dev/blog/': page(''), 'https://site.dev/index.xml': xml }),
  );
  expect(r.map((c) => c.feedUrl)).toEqual(['https://site.dev/index.xml']);
});

test('nothing found → []', async () => {
  expect(await discoverFeeds('https://site.dev/', fake({ 'https://site.dev/': page('') }))).toEqual(
    [],
  );
});

test('fetch errors are swallowed', async () => {
  const f: FetchText = async () => {
    throw new FetchError('TIMEOUT', 'timeout');
  };
  expect(await discoverFeeds('https://site.dev/', f)).toEqual([]);
});

test('ftp://x and 3000-char URL → AppError INVALID_URL', async () => {
  for (const u of ['ftp://x', 'https://a.io/' + 'a'.repeat(3000)]) {
    await expect(discoverFeeds(u, fake({}))).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_URL',
    });
    await expect(discoverFeeds(u, fake({}))).rejects.toBeInstanceOf(AppError);
  }
});
