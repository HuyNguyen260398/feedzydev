import type { Settings } from './types';

export const CRAWL_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const MIN_POSTS_PER_SOURCE = 1;
export const MAX_POSTS_PER_SOURCE = 50;

export const DEFAULT_SETTINGS: Settings = { postsPerSource: 5, crawlHours: [7] };

const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: CRAWL_TIMEZONE,
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Hour of day (0–23) of `at` in CRAWL_TIMEZONE. */
export function localHour(at: Date): number {
  return Number(hourFormat.format(at));
}

export function isValidPostsPerSource(n: unknown): n is number {
  return (
    Number.isInteger(n) &&
    (n as number) >= MIN_POSTS_PER_SOURCE &&
    (n as number) <= MAX_POSTS_PER_SOURCE
  );
}

export function isValidHour(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 23;
}
