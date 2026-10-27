'use client';

import { useEffect, useRef, useState } from 'react';
import EmptyState from '@/components/EmptyState';
import ErrorBanner from '@/components/ErrorBanner';
import FeedGrid from '@/components/FeedGrid';
import FeedLoading from '@/components/FeedLoading';
import FilterBar from '@/components/FilterBar';
import { useMinVisible } from '@/hooks/useMinVisible';
import { usePosts } from '@/hooks/usePosts';
import { getSources } from '@/lib/api';
import { groupByDay, sinceFor, type DateRange } from '@/lib/time';
import type { PublicSource } from '@/lib/types';

const SEARCH_DEBOUNCE_MS = 300;
// Keep the feed loader up at least this long so a fast search or filter doesn't just flicker.
const MIN_LOADER_MS = 400;

export default function FeedPage() {
  const [sourceId, setSourceId] = useState<string>();
  // `since` is fixed when the range is picked so the query key stays stable across renders.
  const [date, setDate] = useState<{ range: DateRange; since?: string }>({ range: 'any' });
  const [sources, setSources] = useState<PublicSource[]>([]);
  // `query` follows the input; `q` is what is searched, once typing pauses.
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const { posts, loading, error, done, loadMore, retry } = usePosts({
    sourceId,
    since: date.since,
    q: q || undefined,
  });

  useEffect(() => {
    const next = query.trim().replace(/\s+/g, ' ');
    if (next === '') return; // cleared in onQueryChange, without waiting
    const t = setTimeout(() => setQ(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  function onQueryChange(value: string) {
    setQuery(value);
    if (value.trim() === '') setQ('');
  }
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getSources().then(
      (items) => live && setSources(items),
      () => {}, // the source filter is optional; the feed still works without it
    );
    return () => {
      live = false;
    };
  }, []);

  // A first page is loading (initial load, or the search/filter changed and the list reset).
  const showLoader = useMinVisible(posts.length === 0 && loading, MIN_LOADER_MS) && !error;
  const hasPosts = posts.length > 0 && !showLoader;
  const canLoadMore = hasPosts && !done && !error;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), {
      rootMargin: '600px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, loadMore]);

  // One clock reading per render, shared by grouping and every card's relative time.
  const now = new Date();
  const groups = groupByDay(posts, now);

  return (
    <div className="space-y-5 sm:space-y-6">
      <h1 className="sr-only">Latest posts</h1>
      <FilterBar
        sources={sources}
        sourceId={sourceId}
        range={date.range}
        query={query}
        onQueryChange={onQueryChange}
        onSourceChange={setSourceId}
        onRangeChange={(range) => setDate({ range, since: sinceFor(range, new Date()) })}
      />

      {error && <ErrorBanner message={error} onRetry={retry} />}

      {showLoader && <FeedLoading />}

      {posts.length === 0 && !loading && !error && !showLoader && (
        <EmptyState
          filtered={sourceId !== undefined || date.range !== 'any'}
          search={q || undefined}
        />
      )}

      {hasPosts && (
        <div className="fz-feed-enter">
          <FeedGrid groups={groups} now={now} />
        </div>
      )}

      {canLoadMore && (
        <div ref={sentinel} className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-5 font-mono text-sm text-muted transition-colors duration-200 hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? 'loading…' : 'Load more'}
          </button>
        </div>
      )}

      {hasPosts && done && (
        <p className="py-6 text-center font-mono text-xs tracking-wide text-muted">
          — you&apos;re all caught up —
        </p>
      )}
    </div>
  );
}
