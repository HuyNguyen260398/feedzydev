import { extractFeedLinks, extractPageMeta } from '../../src/lib/html';

test('extractFeedLinks resolves, dedupes, drops comment feeds', () => {
  const html = `<html><head>
    <link rel="alternate" type="application/rss+xml" href="/feed/">
    <link rel="alternate" type="application/rss+xml" href="/feed/">
    <link rel="alternate" type="application/atom+xml" href="https://x.io/atom.xml">
    <link rel="alternate" type="application/rss+xml" title="Comments Feed" href="/comments/feed/">
  </head></html>`;
  expect(extractFeedLinks(html, 'https://x.io/blog/')).toEqual([
    'https://x.io/feed/',
    'https://x.io/atom.xml',
  ]);
});

test('extractPageMeta reads og:image and icon', () => {
  const html = `<head><meta property="og:image" content="/og.png"><link rel="shortcut icon" href="/fav.ico"></head>`;
  expect(extractPageMeta(html, 'https://x.io/blog/')).toEqual({
    ogImage: 'https://x.io/og.png',
    iconUrl: 'https://x.io/fav.ico',
  });
});
