import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import SplashScreen, { FADE_MS } from '@/components/SplashScreen';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SplashScreen', () => {
  it('fades out and unmounts once the page has loaded', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    render(<SplashScreen />);
    const splash = screen.getByRole('status', { name: 'Loading feedzydev' });
    expect(splash).toHaveClass('opacity-100');

    act(() => vi.advanceTimersByTime(0));
    expect(splash).toHaveClass('opacity-0');

    act(() => vi.advanceTimersByTime(FADE_MS));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays up for a minimum time on a fast load', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(100);
    render(<SplashScreen />);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toHaveClass('opacity-100');
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('status')).toHaveClass('opacity-0');
  });

  it('waits for the load event while the document is still loading', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    render(<SplashScreen />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole('status')).toHaveClass('opacity-100');

    act(() => {
      window.dispatchEvent(new Event('load'));
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('status')).toHaveClass('opacity-0');
  });
});
