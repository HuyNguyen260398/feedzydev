import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePosts } from '@/hooks/usePosts';
import { getPosts } from '@/lib/api';
import type { PublicPost } from '@/lib/types';

vi.mock('@/lib/api', () => ({ getPosts: vi.fn() }));

const post = (id: string): PublicPost => ({
  postId: id,
  url: `https://a.example/${id}`,
  title: id,
  publishedAt: '2026-10-18T00:00:00.000Z',
  sourceId: 's',
  sourceName: 'S',
});

beforeEach(() => {
  vi.mocked(getPosts).mockReset();
});

describe('usePosts', () => {
  it('passes the search text through', async () => {
    vi.mocked(getPosts).mockResolvedValue({ items: [post('a')] });
    const { result } = renderHook(() => usePosts({ q: 'kube' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getPosts).toHaveBeenCalledWith(expect.objectContaining({ q: 'kube', limit: 30 }));
    expect(result.current.done).toBe(true);
  });

  it('keeps fetching while a search page is empty but has a cursor', async () => {
    vi.mocked(getPosts)
      .mockResolvedValueOnce({ items: [], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [post('hit')], nextCursor: 'c3' });
    const { result } = renderHook(() => usePosts({ q: 'rare' }));
    await waitFor(() => expect(result.current.posts).toHaveLength(1));
    expect(result.current.loading).toBe(false);
    expect(result.current.done).toBe(false);
    expect(vi.mocked(getPosts).mock.calls.map((c) => c[0].cursor)).toEqual([undefined, 'c1', 'c2']);
  });

  it('a new search drops the old results', async () => {
    vi.mocked(getPosts).mockImplementation(async (p) => ({ items: [post(p.q ?? 'all')] }));
    const { result, rerender } = renderHook((props: { q?: string }) => usePosts(props), {
      initialProps: { q: 'one' },
    });
    await waitFor(() => expect(result.current.posts[0]?.postId).toBe('one'));
    rerender({ q: 'two' });
    await waitFor(() => expect(result.current.posts.map((p) => p.postId)).toEqual(['two']));
  });
});
