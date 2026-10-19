import { isValidHour, isValidPostsPerSource, localHour } from '../../src/lib/settings';

describe('settings helpers', () => {
  it('localHour is the Asia/Ho_Chi_Minh hour (UTC+7)', () => {
    expect(localHour(new Date('2026-10-17T00:00:00Z'))).toBe(7);
    expect(localHour(new Date('2026-10-17T06:59:59Z'))).toBe(13);
    expect(localHour(new Date('2026-10-17T17:00:00Z'))).toBe(0);
  });

  it('validators', () => {
    expect([1, 50].every(isValidPostsPerSource)).toBe(true);
    expect([0, 51, 2.5, '3', null].some(isValidPostsPerSource)).toBe(false);
    expect([0, 23].every(isValidHour)).toBe(true);
    expect([-1, 24, 1.5, '8'].some(isValidHour)).toBe(false);
  });
});
