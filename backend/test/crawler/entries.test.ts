import { toPosts } from '../../src/crawler/entries';
import type { FeedEntry, Source } from '../../src/lib/types';

const now = new Date('2026-10-17T00:00:00Z');
const LIMIT = 50;
const source: Source = {
  sourceId: 's1',
  name: 'Src',
  siteUrl: 'https://a.io',
  feedUrl: 'https://a.io/feed',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const e = (url: string | undefined, publishedAt?: string): FeedEntry =>
  ({ url, title: 't', publishedAt }) as FeedEntry;

describe('toPosts', () => {
  it('keeps recent, without a TTL (retention is purged by the crawler)', () => {
    const [p] = toPosts([e('https://a.io/1', '2026-10-16T00:00:00Z')], source, now, LIMIT);
    expect(p).not.toHaveProperty('expiresAt');
    expect(p.feedKey).toBe('ALL');
    expect(p.sourceName).toBe('Src');
    expect(p.sourceId).toBe('s1');
    expect(p.crawledAt).toBe(now.toISOString());
  });

  it('14-day boundary', () => {
    const out = toPosts(
      [e('https://a.io/1', '2026-10-03T00:00:00Z'), e('https://a.io/2', '2026-10-02T23:59:59Z')],
      source,
      now,
      LIMIT,
    );
    expect(out.map((p) => p.url)).toEqual(['https://a.io/1']);
  });

  it('honours a shorter age window', () => {
    const out = toPosts(
      [e('https://a.io/1', '2026-10-15T00:00:00Z'), e('https://a.io/2', '2026-10-13T00:00:00Z')],
      source,
      now,
      LIMIT,
      3,
    );
    expect(out.map((p) => p.url)).toEqual(['https://a.io/1']);
  });

  it('drops missing date or url', () => {
    expect(
      toPosts([e('https://a.io/1'), e(undefined, '2026-10-16T00:00:00Z')], source, now, LIMIT),
    ).toEqual([]);
  });

  it('clamps near-future, drops far-future', () => {
    const out = toPosts(
      [e('https://a.io/1', '2026-10-17T12:00:00Z'), e('https://a.io/2', '2026-10-19T00:00:00Z')],
      source,
      now,
      LIMIT,
    );
    expect(out).toHaveLength(1);
    expect(out[0].publishedAt).toBe('2026-10-17T00:00:00.000Z');
  });

  it('keeps only the newest `limit`, newest first', () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      e(`https://a.io/${i}`, `2026-10-${String(9 + ((i * 3) % 8)).padStart(2, '0')}T00:00:00Z`),
    );
    const out = toPosts(entries, source, now, 5);
    expect(out.map((p) => p.publishedAt.slice(0, 10))).toEqual([
      '2026-10-16',
      '2026-10-15',
      '2026-10-14',
      '2026-10-13',
      '2026-10-12',
    ]);
  });

  it('dedupes tracking variants', () => {
    const out = toPosts(
      [
        e('https://a.io/p?utm_source=x', '2026-10-16T00:00:00Z'),
        e('https://A.io/p', '2026-10-16T00:00:00Z'),
      ],
      source,
      now,
      LIMIT,
    );
    expect(out).toHaveLength(1);
  });
});
