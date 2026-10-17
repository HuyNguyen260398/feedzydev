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

export function usePosts(sourceId?: string): UsePosts {
  const [state, setState] = useState<State>(() => initial(sourceId));
  const reqId = useRef(0);
  const pending = useRef(false);

  // Only the latest request may write state; older responses are dropped.
  const run = useCallback((key: string | undefined, cursor: string | undefined) => {
    const id = ++reqId.current;
    pending.current = true;
    getPosts({ sourceId: key, cursor, limit: PAGE_SIZE }).then(
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
  useEffect(() => run(sourceId, undefined), [sourceId, run]);

  // Until the first page for a new sourceId lands, present a fresh loading state.
  const view = state.key === sourceId ? state : initial(sourceId);

  const loadMore = useCallback(() => {
    if (pending.current || view.done || view.error || !view.nextCursor) return;
    setState((s) => ({ ...s, loading: true }));
    run(sourceId, view.nextCursor);
  }, [run, sourceId, view.done, view.error, view.nextCursor]);

  const retry = useCallback(() => {
    if (pending.current) return;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    run(sourceId, view.posts.length > 0 ? view.nextCursor : undefined);
  }, [run, sourceId, view.posts.length, view.nextCursor]);

  return {
    posts: view.posts,
    loading: view.loading,
    error: view.error,
    done: view.done,
    loadMore,
    retry,
  };
}
