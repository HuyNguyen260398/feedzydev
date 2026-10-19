// Mirrors backend/src/lib/settings.ts bounds.
export const MIN_POSTS = 1;
export const MAX_POSTS = 50;

export const KEEP_FOREVER = 0;
export const RETENTION_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: KEEP_FOREVER, label: 'Forever' },
];
