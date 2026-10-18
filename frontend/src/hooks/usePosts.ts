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
}

const keyOf = (f: PostFilter) => `${f.sourceId ?? ''}|${f.since ?? ''}`;

export function usePosts({ sourceId, since }: PostFilter = {}): UsePosts {
  const filterKey = keyOf({ sourceId, since });
  const [state, setState] = useState<State>(() => initial(filterKey));
  const reqId = useRef(0);
  const pending = useRef(false);

  // Only the latest request may write state; older responses are dropped.
  const run = useCallback((filter: PostFilter, cursor: string | undefined) => {
    const id = ++reqId.current;
    const key = keyOf(filter);
    pending.current = true;
    getPosts({ ...filter, cursor, limit: PAGE_SIZE }).then(
      (page) => {
        if (id !== reqId.current) return;
        pending.current = false;
        setState((s) => ({
          key,
          posts: cursor && s.key === key ? [...s.posts, ...page.items] : page.items,
          nextCursor: page.nextCursor,
          loading: false,
          done: !page.nextCursor,
        }));
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
  }, []);

  // Starting a new first-page request supersedes any in-flight one (see reqId).
  useEffect(() => run({ sourceId, since }, undefined), [sourceId, since, run]);

  // Until the first page for a new filter lands, present a fresh loading state.
  const view = state.key === filterKey ? state : initial(filterKey);

  const loadMore = useCallback(() => {
    if (pending.current || view.done || view.error || !view.nextCursor) return;
    setState((s) => ({ ...s, loading: true }));
    run({ sourceId, since }, view.nextCursor);
  }, [run, sourceId, since, view.done, view.error, view.nextCursor]);

  const retry = useCallback(() => {
    if (pending.current) return;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run({ sourceId, since }, view.posts.length > 0 ? view.nextCursor : undefined);
  }, [run, sourceId, since, view.posts.length, view.nextCursor]);

  return {
    posts: view.posts,
    loading: view.loading,
    error: view.error,
    done: view.done,
    loadMore,
    retry,
  };
}
