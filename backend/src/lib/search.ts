import type { Post } from './types';

export const MAX_SEARCH_LENGTH = 100;

/** Lower-cased whitespace-separated terms; empty when there is nothing to search for. */
export function searchTerms(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.slice(0, MAX_SEARCH_LENGTH).toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every term must appear in the post's title or source name (case-insensitive). */
export function matchesSearch(post: Pick<Post, 'title' | 'sourceName'>, terms: string[]): boolean {
  const haystack = `${post.title}\n${post.sourceName}`.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}
