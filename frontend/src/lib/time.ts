import type { PublicPost } from '@/lib/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative time for recent posts, otherwise a short local date + time. */
export function formatPostTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }).format(then);
}

/** Full local date-time, used as the `<time>` tooltip. */
export function formatFullTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayLabelFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

export interface DayGroup {
  key: string;
  label: string;
  posts: PublicPost[];
}

/** Groups consecutive posts by local calendar day, preserving input order. */
export function groupByDay(posts: PublicPost[], now: Date): DayGroup[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const post of posts) {
    const d = new Date(post.publishedAt);
    const key = dayKey(d);
    let group = byKey.get(key);
    if (!group) {
      const label =
        key === today ? 'Today' : key === yesterday ? 'Yesterday' : dayLabelFormat.format(d);
      group = { key, label, posts: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.posts.push(post);
  }
  return groups;
}
