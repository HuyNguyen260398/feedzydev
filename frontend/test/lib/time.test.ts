import { describe, expect, it } from 'vitest';
import { formatHour, formatPostTime, groupByDay, sinceFor, zoneOffsetLabel } from '@/lib/time';
import type { PublicPost } from '@/lib/types';

const now = new Date('2026-10-17T10:00:00');
const iso = (local: string) => new Date(local).toISOString();

function post(id: string, local: string): PublicPost {
  return {
    postId: id,
    url: `https://example.com/${id}`,
    title: id,
    publishedAt: iso(local),
    sourceId: 's',
    sourceName: 'S',
  };
}

describe('formatPostTime', () => {
  it('just now under a minute', () => {
    expect(formatPostTime(iso('2026-10-17T09:59:30'), now)).toBe('just now');
  });
  it('minutes under an hour', () => {
    expect(formatPostTime(iso('2026-10-17T09:15:00'), now)).toBe('45m ago');
  });
  it('hours under a day', () => {
    expect(formatPostTime(iso('2026-10-16T12:00:00'), now)).toBe('22h ago');
  });
  it('date beyond a day', () => {
    expect(formatPostTime(iso('2026-10-15T08:30:00'), now)).toMatch(/Oct 15/);
  });
});

describe('groupByDay', () => {
  it('groups by local day, keeping order', () => {
    const groups = groupByDay(
      [
        post('a', '2026-10-17T09:00:00'),
        post('b', '2026-10-17T00:30:00'),
        post('c', '2026-10-16T23:30:00'),
        post('d', '2026-10-14T12:00:00'),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Wed, Oct 14']);
    expect(groups.map((g) => g.posts.length)).toEqual([2, 1, 1]);
    expect(groups.map((g) => g.key)).toEqual(['2026-10-17', '2026-10-16', '2026-10-14']);
    expect(groups[0].posts.map((p) => p.postId)).toEqual(['a', 'b']);
  });
});

describe('sinceFor', () => {
  it('any → undefined', () => {
    expect(sinceFor('any', now)).toBeUndefined();
  });
  it('today starts at local midnight', () => {
    expect(sinceFor('today', now)).toBe(iso('2026-10-17T00:00:00'));
  });
  it('day ranges subtract whole days', () => {
    expect(sinceFor('3d', now)).toBe(new Date(now.getTime() - 3 * 86_400_000).toISOString());
    expect(sinceFor('30d', now)).toBe(new Date(now.getTime() - 30 * 86_400_000).toISOString());
  });
});

describe('formatHour / zoneOffsetLabel', () => {
  it('formats 12-hour clock labels', () => {
    expect([0, 8, 12, 13, 23].map(formatHour)).toEqual(['12 AM', '8 AM', '12 PM', '1 PM', '11 PM']);
  });
  it('labels a zone by its GMT offset', () => {
    expect(zoneOffsetLabel('Asia/Ho_Chi_Minh')).toBe('GMT+7');
    expect(zoneOffsetLabel('Not/AZone')).toBe('Not/AZone');
  });
});
