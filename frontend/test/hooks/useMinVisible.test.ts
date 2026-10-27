import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMinVisible } from '@/hooks/useMinVisible';

afterEach(() => {
  vi.useRealTimers();
});

describe('useMinVisible', () => {
  it('stays on for the minimum time when the work finishes fast', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useMinVisible(active, 400), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(100));
    rerender({ active: false });
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('turns off right away once the minimum has already passed', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useMinVisible(active, 400), {
      initialProps: { active: true },
    });
    act(() => vi.advanceTimersByTime(1_000));
    rerender({ active: false });
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toBe(false);
  });

  it('is off when never activated', () => {
    const { result } = renderHook(() => useMinVisible(false, 400));
    expect(result.current).toBe(false);
  });
});
