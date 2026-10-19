import { getIdToken } from '@/lib/auth';
import type {
  AdminSource,
  CrawlSettings,
  FeedCandidate,
  Page,
  PublicPost,
  PublicSource,
} from '@/lib/types';

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

export async function getPosts(p: {
  cursor?: string;
  sourceId?: string;
  since?: string;
  /** Free-text search over title and source name. */
  q?: string;
  limit?: number;
}): Promise<Page<PublicPost>> {
  // Inline comparison so Next inlines the env var and drops the mock chunk in normal builds.
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockPosts(p);
  const qs = new URLSearchParams();
  if (p.cursor) qs.set('cursor', p.cursor);
  if (p.sourceId) qs.set('sourceId', p.sourceId);
  if (p.since) qs.set('since', p.since);
  if (p.q) qs.set('q', p.q);
  if (p.limit !== undefined) qs.set('limit', String(p.limit));
  const q = qs.toString();
  return request<Page<PublicPost>>(`/posts${q ? `?${q}` : ''}`);
}

export async function getSources(): Promise<PublicSource[]> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockSources();
  return (await request<{ items: PublicSource[] }>('/sources')).items;
}

export async function listAdminSources(): Promise<AdminSource[]> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockAdminList();
  return (await request<{ items: AdminSource[] }>('/admin/sources', { admin: true })).items;
}

export async function discover(url: string): Promise<FeedCandidate[]> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockDiscover(url);
  const r = await request<{ candidates: FeedCandidate[] }>('/admin/sources/discover', {
    method: 'POST',
    body: { url },
    admin: true,
  });
  return r.candidates;
}

export async function addSource(i: {
  feedUrl: string;
  name?: string;
  iconUrl?: string;
}): Promise<AdminSource> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockAdd(i);
  return request<AdminSource>('/admin/sources', { method: 'POST', body: i, admin: true });
}

export async function updateSource(
  id: string,
  patch: { name?: string; enabled?: boolean; postsPerSource?: number | null },
): Promise<AdminSource> {
  if (process.env.NEXT_PUBLIC_MOCK === '1')
    return (await import('@/lib/mock')).mockUpdate(id, patch);
  return request<AdminSource>(`/admin/sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
    admin: true,
  });
}

export async function deleteSource(id: string): Promise<void> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockDelete(id);
  await request<void>(`/admin/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    admin: true,
  });
}

export async function triggerCrawl(sourceId?: string): Promise<void> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockCrawl();
  await request<unknown>('/admin/crawl', {
    method: 'POST',
    body: sourceId ? { sourceId } : {},
    admin: true,
  });
}

export async function getSettings(): Promise<CrawlSettings> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockGetSettings();
  return request<CrawlSettings>('/admin/settings', { admin: true });
}

export async function saveSettings(s: {
  postsPerSource: number;
  crawlHours: number[];
  retentionDays: number;
}): Promise<CrawlSettings> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') return (await import('@/lib/mock')).mockSaveSettings(s);
  return request<CrawlSettings>('/admin/settings', { method: 'PUT', body: s, admin: true });
}
