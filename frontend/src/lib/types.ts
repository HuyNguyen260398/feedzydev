// Mirrors backend/src/lib/types.ts (public + admin shapes).
export interface PublicPost {
  postId: string;
  url: string;
  title: string;
  author?: string;
  publishedAt: string;
  thumbnailUrl?: string;
  sourceId: string;
  sourceName: string;
}

export interface PublicSource {
  sourceId: string;
  name: string;
  siteUrl: string;
  iconUrl?: string;
}

export interface AdminSource {
  sourceId: string;
  name: string;
  siteUrl: string;
  feedUrl: string;
  iconUrl?: string;
  enabled: boolean;
  createdAt: string;
  lastCrawledAt?: string;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
  lastNewCount?: number;
  postsPerSource?: number;
}

export interface CrawlSettings {
  postsPerSource: number;
  crawlHours: number[];
  timezone: string;
  updatedAt?: string;
}

export interface FeedCandidate {
  feedUrl: string;
  title: string;
  siteUrl: string;
  iconUrl?: string;
  preview: { title: string; publishedAt?: string }[];
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}
