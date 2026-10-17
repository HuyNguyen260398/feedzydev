import { normalizeUrl, postIdFor, resolveUrl } from '../../src/lib/url';

test('normalizeUrl lowercases host, strips fragment and utm params', () => {
  expect(normalizeUrl('HTTPS://Blog.Example.com/a/?utm_source=x&b=1&utm_medium=rss#frag')).toBe(
    'https://blog.example.com/a/?b=1',
  );
});

test('postIdFor is stable across tracking variants', () => {
  const a = postIdFor('https://blog.example.com/p?utm_source=rss');
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(postIdFor('https://BLOG.example.com/p#x')).toBe(a);
});

test.each([
  ['//cdn.x.io/a.png', 'https://b.com/', 'https://cdn.x.io/a.png'],
  ['/i.png', 'https://b.com/p/q/', 'https://b.com/i.png'],
  ['img/i.png', 'https://b.com/p/q/', 'https://b.com/p/q/img/i.png'],
  ['https://abs.io/z.jpg', 'https://b.com/', 'https://abs.io/z.jpg'],
])('resolveUrl(%s, %s)', (href, base, want) => expect(resolveUrl(href, base)).toBe(want));

test('resolveUrl rejects junk', () => {
  expect(resolveUrl('', 'https://b.com/')).toBeUndefined();
  expect(resolveUrl('javascript:alert(1)', 'https://b.com/')).toBeUndefined();
  expect(resolveUrl(undefined, 'https://b.com/')).toBeUndefined();
});
