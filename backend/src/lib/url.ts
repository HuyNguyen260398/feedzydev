import { createHash } from 'node:crypto';
import { AppError } from './errors';

const MAX_URL_LENGTH = 2048;

export function assertHttpUrl(url: unknown): string {
  const invalid = new AppError(400, 'INVALID_URL', 'Enter a valid http(s) URL.');
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) throw invalid;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw invalid;
  } catch {
    throw invalid;
  }
  return url;
}

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
