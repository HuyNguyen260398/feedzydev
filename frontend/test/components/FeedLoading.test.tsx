import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FeedLoading from '@/components/FeedLoading';

describe('FeedLoading', () => {
  it('announces loading with the branded mark', () => {
    const { container } = render(<FeedLoading />);
    expect(screen.getByRole('status', { name: 'Loading posts' })).toBeInTheDocument();
    expect(container.querySelector('.fz-splash-bar')).toBeInTheDocument();
  });
});
