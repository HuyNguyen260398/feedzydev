'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPosts } from '@/lib/api';
import type { PublicPost } from '@/lib/types';

const PAGE_SIZE = 30;

interface State {
  key?: string;
  posts: PublicPost[];
  nextCursor?: string;
  loading: boolean;
  error?: string;
  done: boolean;
}

const initial = (key?: string): State => ({ key, posts: [], loading: true, done: false });

export interface UsePosts {
  posts: PublicPost[];
  loading: boolean;
  error?: string;
  done: boolean;
  loadMore(): void;
  retry(): void;
}

export interface PostFilter {
  sourceId?: string;
  since?: string;
  q?: string;
}

const keyOf = (f: PostFilter) => `${f.sourceId ?? ''}|${f.since ?? ''}|${f.q ?? ''}`;

export function usePosts({ sourceId, since, q }: PostFilter = {}): UsePosts {
  const filterKey = keyOf({ sourceId, since, q });
  const [state, setState] = useState<State>(() => initial(filterKey));
  const reqId = useRef(0);
  const pending = useRef(false);

  // Only the latest request may write state; older responses are dropped.
  const run = useCallback((filter: PostFilter, cursor: string | undefined) => {
    const id = ++reqId.current;
    const key = keyOf(filter);
    pending.current = true;
    const fetchPage = (from: string | undefined) =>
      getPosts({ ...filter, cursor: from, limit: PAGE_SIZE }).then(
        (page) => {
          if (id !== reqId.current) return;
          // A search can use up its scan budget with no match while more posts remain: keep going.
          const keepGoing = page.items.length === 0 && !!page.nextCursor;
          if (!keepGoing) pending.current = false;
          setState((s) => ({
            key,
            posts: from && s.key === key ? [...s.posts, ...page.items] : page.items,
            nextCursor: page.nextCursor,
            loading: keepGoing,
            done: !page.nextCursor,
          }));
          if (keepGoing) void fetchPage(page.nextCursor);
        },
        (err: unknown) => {
          if (id !== reqId.current) return;
          pending.current = false;
          setState((s) => ({
            ...(s.key === key ? s : initial(key)),
            loading: false,
            error: err instanceof Error ? err.message : 'Could not load posts.',
          }));
        },
      );
    void fetchPage(cursor);
  }, []);

  // Starting a new first-page request supersedes any in-flight one (see reqId).
  useEffect(() => run({ sourceId, since, q }, undefined), [sourceId, since, q, run]);

  // Until the first page for a new filter lands, present a fresh loading state.
  const view = state.key === filterKey ? state : initial(filterKey);

  const loadMore = useCallback(() => {
    if (pending.current || view.done || view.error || !view.nextCursor) return;
    setState((s) => ({ ...s, loading: true }));
    run({ sourceId, since, q }, view.nextCursor);
  }, [run, sourceId, since, q, view.done, view.error, view.nextCursor]);

  const retry = useCallback(() => {
    if (pending.current) return;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run({ sourceId, since, q }, view.posts.length > 0 ? view.nextCursor : undefined);
  }, [run, sourceId, since, q, view.posts.length, view.nextCursor]);

  return {
    posts: view.posts,
    loading: view.loading,
    error: view.error,
    done: view.done,
    loadMore,
    retry,
  };
}
