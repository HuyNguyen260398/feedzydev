import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PostCard from '@/components/PostCard';
import type { PublicPost } from '@/lib/types';

const now = new Date('2026-10-17T10:00:00');

const base: PublicPost = {
  postId: 'p1',
  url: 'https://blog.example.com/k8s-upgrade',
  title: 'Zero-downtime Kubernetes upgrades',
  author: 'Jane Doe',
  publishedAt: new Date('2026-10-17T09:15:00').toISOString(),
  thumbnailUrl: 'https://cdn.example.com/k8s.png',
  sourceId: 'src1',
  sourceName: 'Kube Weekly',
};

describe('PostCard', () => {
  it('renders all card fields and links out', () => {
    const { container } = render(<PostCard post={base} variant="tile" now={now} />);
    expect(screen.getByText(base.title)).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Kube Weekly')).toBeInTheDocument();
    const time = container.querySelector(`time[datetime="${base.publishedAt}"]`);
    expect(time).not.toBeNull();
    expect(time).toHaveTextContent('45m ago');
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', base.url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits author when absent', () => {
    render(<PostCard post={{ ...base, author: undefined }} variant="tile" now={now} />);
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('falls back to placeholder when image errors', () => {
    const { container } = render(<PostCard post={base} variant="featured" now={now} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('placeholder when no thumbnailUrl', () => {
    const { container } = render(
      <PostCard post={{ ...base, thumbnailUrl: undefined }} variant="tile" now={now} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('K')).toBeInTheDocument();
  });
});
