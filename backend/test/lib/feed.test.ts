import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFeed } from '../../src/lib/feed';

const fx = (n: string) => readFileSync(join(__dirname, '../fixtures', n), 'utf8');
test('rss2: channel and entries', () => {
  const f = parseFeed(fx('rss2-media.xml'), 'https://blog.example.com/feed')!;
  expect(f.title).toBe('Example DevOps Blog');
  expect(f.siteUrl).toBe('https://blog.example.com/');
  expect(f.entries).toHaveLength(4);
  expect(f.entries[0]).toEqual({
    url: 'https://blog.example.com/posts/blue-green?utm_source=rss',
    title: 'Blue/Green & Canary with ECS',
    author: 'Jane Doe',
    publishedAt: '2026-10-16T23:12:00.000Z',
    thumbnailUrl: 'https://cdn.example.com/bg.png',
  });
  expect(f.entries[1]).toMatchObject({
    title: 'It’s relative',
    publishedAt: '2026-10-15T01:00:00.000Z',
    thumbnailUrl: 'https://blog.example.com/images/rel.png',
  });
  expect(f.entries[1].author).toBeUndefined();
  expect(f.entries[2]).toMatchObject({
    author: 'Ops Team',
    thumbnailUrl: 'https://cdn.example.com/enc.jpg',
  });
  expect(f.entries[3].publishedAt).toBeUndefined();
});
test('atom: alternate link, html title, media:content', () => {
  const f = parseFeed(fx('atom.xml'), 'https://atom.example.org/feed.xml')!;
  expect(f).toMatchObject({ title: 'Atom Ops', siteUrl: 'https://atom.example.org/' });
  expect(f.entries[0]).toEqual({
    url: 'https://atom.example.org/2026/10/stacks/',
    title: 'Terraform 1.12 stacks',
    author: 'Team Atom',
    publishedAt: '2026-10-16T05:00:00.000Z',
    thumbnailUrl: 'https://atom.example.org/stacks.webp',
  });
  expect(f.entries[1].publishedAt).toBe('2026-10-11T22:00:00.000Z');
});
test('rss1: single item still yields an array', () => {
  const f = parseFeed(fx('rss1.xml'), 'https://rdf.example.net/rss')!;
  expect(f.title).toBe('RDF Blog');
  expect(f.entries).toEqual([
    {
      url: 'https://rdf.example.net/p1',
      title: 'P1',
      author: 'R. Writer',
      publishedAt: '2026-10-10T12:00:00.000Z',
    },
  ]);
});
test.each(['<html><body>hi</body></html>', 'not xml at all', ''])('non-feed %p → null', (s) => {
  expect(parseFeed(s, 'https://x.io/')).toBeNull();
});
test.each(['aws-devops.xml', 'kubernetes.xml'])('real feed %s parses', (n) => {
  const f = parseFeed(fx(n), 'https://example.com/')!;
  expect(f.entries.length).toBeGreaterThan(0);
  for (const e of f.entries) {
    expect(e.url).toMatch(/^https:\/\//);
    expect(e.title.length).toBeGreaterThan(0);
    expect(e.publishedAt).toBeDefined();
  }
});

test('rss: bare email author is omitted, "email (Name)" keeps the name', () => {
  const rss = (a: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>A</title><link>https://b.example/a</link><author>${a}</author></item></channel></rss>`;
  expect(
    parseFeed(rss('jane@example.com'), 'https://b.example/f')!.entries[0].author,
  ).toBeUndefined();
  expect(
    parseFeed(rss('jane@example.com (Jane Doe)'), 'https://b.example/f')!.entries[0].author,
  ).toBe('Jane Doe');
});
