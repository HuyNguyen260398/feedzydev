import { toPosts, RETENTION_DAYS } from '../../src/crawler/entries';
import type { FeedEntry, Source } from '../../src/lib/types';

const now = new Date('2026-10-17T00:00:00Z');
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
  it('keeps recent, sets expiresAt', () => {
    const [p] = toPosts([e('https://a.io/1', '2026-10-16T00:00:00Z')], source, now);
    expect(RETENTION_DAYS).toBe(90);
    expect(p.expiresAt).toBe(Date.parse('2026-10-16T00:00:00Z') / 1000 + 7776000);
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
    );
    expect(out.map((p) => p.url)).toEqual(['https://a.io/1']);
  });

  it('drops missing date or url', () => {
    expect(
      toPosts([e('https://a.io/1'), e(undefined, '2026-10-16T00:00:00Z')], source, now),
    ).toEqual([]);
  });

  it('clamps near-future, drops far-future', () => {
    const out = toPosts(
      [e('https://a.io/1', '2026-10-17T12:00:00Z'), e('https://a.io/2', '2026-10-19T00:00:00Z')],
      source,
      now,
    );
    expect(out).toHaveLength(1);
    expect(out[0].publishedAt).toBe('2026-10-17T00:00:00.000Z');
  });

  it('dedupes tracking variants', () => {
    const out = toPosts(
      [
        e('https://a.io/p?utm_source=x', '2026-10-16T00:00:00Z'),
        e('https://A.io/p', '2026-10-16T00:00:00Z'),
      ],
      source,
      now,
    );
    expect(out).toHaveLength(1);
  });
});
