import { getIdToken } from '@/lib/auth';
import type { AdminSource, FeedCandidate, Page, PublicPost, PublicSource } from '@/lib/types';

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; admin?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.admin) {
    const token = await getIdToken();
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in required.');
    headers.Authorization = token;
  }
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Request failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      if (data.error?.code) code = data.error.code;
      if (data.error?.message) message = data.error.message;
    } catch {
      // non-JSON error body; keep defaults
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function getPosts(p: {
  cursor?: string;
  sourceId?: string;
  limit?: number;
}): Promise<Page<PublicPost>> {
  const qs = new URLSearchParams();
  if (p.cursor) qs.set('cursor', p.cursor);
  if (p.sourceId) qs.set('sourceId', p.sourceId);
  if (p.limit !== undefined) qs.set('limit', String(p.limit));
  const q = qs.toString();
  return request<Page<PublicPost>>(`/posts${q ? `?${q}` : ''}`);
}

export async function getSources(): Promise<PublicSource[]> {
  return (await request<{ items: PublicSource[] }>('/sources')).items;
}

export async function listAdminSources(): Promise<AdminSource[]> {
  return (await request<{ items: AdminSource[] }>('/admin/sources', { admin: true })).items;
}

export async function discover(url: string): Promise<FeedCandidate[]> {
  const r = await request<{ candidates: FeedCandidate[] }>('/admin/sources/discover', {
    method: 'POST',
    body: { url },
    admin: true,
  });
  return r.candidates;
}

export function addSource(i: { feedUrl: string; name?: string }): Promise<AdminSource> {
  return request<AdminSource>('/admin/sources', { method: 'POST', body: i, admin: true });
}

export function updateSource(
  id: string,
  patch: { name?: string; enabled?: boolean },
): Promise<AdminSource> {
  return request<AdminSource>(`/admin/sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    admin: true,
  });
}

export async function deleteSource(id: string): Promise<void> {
  await request<void>(`/admin/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    admin: true,
  });
}

export async function triggerCrawl(sourceId?: string): Promise<void> {
  await request<unknown>('/admin/crawl', {
    method: 'POST',
    body: sourceId ? { sourceId } : {},
    admin: true,
  });
}
