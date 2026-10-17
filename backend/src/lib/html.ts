import { parse } from 'node-html-parser';
import { resolveUrl } from './url';

const FEED_TYPES = new Set(['application/rss+xml', 'application/atom+xml']);

function relTokens(rel: string | undefined): string[] {
  return (rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

export function extractFeedLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const el of parse(html).querySelectorAll('link')) {
    if (!relTokens(el.getAttribute('rel')).includes('alternate')) continue;
    if (!FEED_TYPES.has((el.getAttribute('type') ?? '').trim().toLowerCase())) continue;
    const href = el.getAttribute('href');
    if (/comments/i.test(href ?? '') || /comments/i.test(el.getAttribute('title') ?? '')) continue;
    const abs = resolveUrl(href, baseUrl);
    if (abs && !out.includes(abs)) out.push(abs);
  }
  return out;
}

export function extractPageMeta(
  html: string,
  baseUrl: string,
): { ogImage?: string; iconUrl?: string } {
  const root = parse(html);
  const metaContent = (attr: 'property' | 'name', key: string): string | undefined => {
    for (const el of root.querySelectorAll('meta')) {
      if ((el.getAttribute(attr) ?? '').toLowerCase() === key) {
        const abs = resolveUrl(el.getAttribute('content'), baseUrl);
        if (abs) return abs;
      }
    }
    return undefined;
  };
  const linkHref = (token: string): string | undefined => {
    for (const el of root.querySelectorAll('link')) {
      if (relTokens(el.getAttribute('rel')).includes(token)) {
        const abs = resolveUrl(el.getAttribute('href'), baseUrl);
        if (abs) return abs;
      }
    }
    return undefined;
  };
  const ogImage =
    metaContent('property', 'og:image') ??
    metaContent('property', 'og:image:url') ??
    metaContent('name', 'twitter:image');
  const iconUrl = linkHref('icon') ?? linkHref('apple-touch-icon');
  return {
    ...(ogImage ? { ogImage } : {}),
    ...(iconUrl ? { iconUrl } : {}),
  };
}
