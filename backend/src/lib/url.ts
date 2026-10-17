import { createHash } from 'node:crypto';

export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  const kept = [...u.searchParams.entries()].filter(([k]) => !k.toLowerCase().startsWith('utm_'));
  if (kept.length === u.searchParams.size) return u.toString();
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  return u.toString();
}

export function postIdFor(url: string): string {
  return createHash('sha256').update(normalizeUrl(url)).digest('hex');
}

export function resolveUrl(href: string | undefined, base: string): string | undefined {
  if (!href || !href.trim()) return undefined;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
