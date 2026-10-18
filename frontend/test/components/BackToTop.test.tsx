import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BackToTop from '@/components/BackToTop';

function scrollTo(y: number) {
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new Event('scroll'));
  });
}

afterEach(() => {
  scrollTo(0);
  vi.restoreAllMocks();
});

describe('BackToTop', () => {
  it('is hidden near the top and shown after scrolling down', () => {
    render(<BackToTop />);
    const button = screen.getByTitle('Back to top');
    expect(button).toHaveAttribute('aria-hidden', 'true');
    scrollTo(1200);
    expect(button).toHaveAttribute('aria-hidden', 'false');
    scrollTo(100);
    expect(button).toHaveAttribute('aria-hidden', 'true');
  });

  it('scrolls the window to the top', () => {
    const spy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<BackToTop />);
    scrollTo(1200);
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });
});
