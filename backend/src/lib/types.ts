export interface FeedEntry {
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
}
export interface ParsedFeed {
  title: string;
  siteUrl?: string;
  entries: FeedEntry[];
}
export interface Source {
  sourceId: string;
  name: string;
  /** Replaces name on post tags and in the sources filter. */
  shortName?: string;
  siteUrl: string;
  feedUrl: string;
  iconUrl?: string;
  enabled: boolean;
  createdAt: string;
  lastCrawledAt?: string;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
  lastNewCount?: number;
  /** Overrides Settings.postsPerSource for this source. */
  postsPerSource?: number;
}
export interface Settings {
  /** Newest posts kept per source per crawl. */
  postsPerSource: number;
  /** Local hours (0–23, CRAWL_TIMEZONE) at which the scheduled crawl runs; empty = off. */
  crawlHours: number[];
  /** Posts published more than this many days ago are deleted; 0 = keep forever. */
  retentionDays: number;
  updatedAt?: string;
}
export interface Post {
  postId: string;
  url: string;
  title: string;
  author?: string;
  publishedAt: string;
  thumbnailUrl?: string;
  sourceId: string;
  /** The source's name when crawled; the API reports the current name instead. */
  sourceName: string;
  feedKey: 'ALL';
  crawledAt: string;
  /** Legacy DynamoDB TTL; retention is now enforced by the crawler's purge. */
  expiresAt?: number;
}
export type PublicPost = Omit<Post, 'feedKey' | 'expiresAt' | 'crawledAt'> & {
  sourceShortName?: string;
};
export interface FeedCandidate {
  feedUrl: string;
  title: string;
  siteUrl: string;
  iconUrl?: string;
  preview: { title: string; publishedAt?: string }[];
}
