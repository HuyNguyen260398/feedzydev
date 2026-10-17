'use client';

import { useEffect, useRef, useState } from 'react';
import EmptyState from '@/components/EmptyState';
import ErrorBanner from '@/components/ErrorBanner';
import FeedGrid from '@/components/FeedGrid';
import FilterChips from '@/components/FilterChips';
import SkeletonCard from '@/components/SkeletonCard';
import { usePosts } from '@/hooks/usePosts';
import { getSources } from '@/lib/api';
import { groupByDay } from '@/lib/time';
import type { PublicSource } from '@/lib/types';

export default function FeedPage() {
  const [sourceId, setSourceId] = useState<string>();
  const [sources, setSources] = useState<PublicSource[]>([]);
  const { posts, loading, error, done, loadMore, retry } = usePosts(sourceId);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getSources().then(
      (items) => live && setSources(items),
      () => {}, // chips are optional; the feed still works without them
    );
    return () => {
      live = false;
    };
  }, []);

  const hasPosts = posts.length > 0;
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
      {sources.length > 0 && (
        <FilterChips sources={sources} value={sourceId} onChange={setSourceId} />
      )}

      {error && <ErrorBanner message={error} onRetry={retry} />}

      {!hasPosts && loading && (
        <div
          role="status"
          aria-label="Loading posts"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={i === 0 ? 'sm:col-span-2 lg:row-span-2' : ''}>
              <SkeletonCard featured={i === 0} />
            </div>
          ))}
        </div>
      )}

      {!hasPosts && !loading && !error && <EmptyState />}

      {hasPosts && <FeedGrid groups={groups} sources={sources} now={now} />}

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
