import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddSourceForm from '@/components/sources/AddSourceForm';
import { ApiError, addSource, discover } from '@/lib/api';
import type { FeedCandidate } from '@/lib/types';
import { expectIconOnly } from '../helpers';

vi.mock('@/lib/api', async () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError, discover: vi.fn(), addSource: vi.fn() };
});

const c1: FeedCandidate = {
  feedUrl: 'https://a.example.com/feed.xml',
  title: 'Blog A',
  siteUrl: 'https://a.example.com',
  preview: [{ title: 'Post A1', publishedAt: new Date().toISOString() }, { title: 'Post A2' }],
};
const c2: FeedCandidate = {
  feedUrl: 'https://b.example.com/rss',
  title: 'Blog B',
  siteUrl: 'https://b.example.com',
  preview: [{ title: 'Post B1' }],
};

async function submitUrl() {
  fireEvent.change(screen.getByPlaceholderText('https://example.com/blog or feed URL'), {
    target: { value: 'https://example.com/blog' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Discover' }));
}

beforeEach(() => {
  vi.mocked(discover).mockReset();
  vi.mocked(addSource).mockReset();
});

describe('AddSourceForm', () => {
  it('discover → candidates → add selected', async () => {
    vi.mocked(discover).mockResolvedValue([c1, c2]);
    vi.mocked(addSource).mockResolvedValue({} as never);
    const onAdded = vi.fn();
    render(<AddSourceForm onAdded={onAdded} />);
    await submitUrl();
    expect(discover).toHaveBeenCalledWith('https://example.com/blog');
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText('Post A1')).toBeInTheDocument();
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add selected (1)' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(addSource).toHaveBeenCalledTimes(1);
    expect(addSource).toHaveBeenCalledWith({ feedUrl: c2.feedUrl });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('sends the candidate iconUrl when present', async () => {
    vi.mocked(discover).mockResolvedValue([{ ...c1, iconUrl: 'https://a.example.com/i.png' }]);
    vi.mocked(addSource).mockResolvedValue({} as never);
    render(<AddSourceForm onAdded={vi.fn()} />);
    await submitUrl();
    await screen.findAllByRole('checkbox');
    fireEvent.click(screen.getByRole('button', { name: 'Add selected (1)' }));
    await waitFor(() => expect(addSource).toHaveBeenCalledTimes(1));
    expect(addSource).toHaveBeenCalledWith({
      feedUrl: c1.feedUrl,
      iconUrl: 'https://a.example.com/i.png',
    });
  });

  it('shows NO_FEED_FOUND message', async () => {
    const msg = 'No RSS/Atom feed found at this URL — try pasting the feed URL directly.';
    vi.mocked(discover).mockRejectedValue(new ApiError(422, 'NO_FEED_FOUND', msg));
    render(<AddSourceForm onAdded={vi.fn()} />);
    await submitUrl();
    expect(await screen.findByText(msg)).toBeInTheDocument();
  });

  it('409 marks candidate already added and continues', async () => {
    vi.mocked(discover).mockResolvedValue([c1, c2]);
    vi.mocked(addSource).mockImplementation(async (i) => {
      if (i.feedUrl === c1.feedUrl) throw new ApiError(409, 'CONFLICT', 'Source exists.');
      return {} as never;
    });
    const onAdded = vi.fn();
    render(<AddSourceForm onAdded={onAdded} />);
    await submitUrl();
    await screen.findAllByRole('checkbox');
    fireEvent.click(screen.getByRole('button', { name: 'Add selected (2)' }));
    expect(await screen.findByText('Already added')).toBeInTheDocument();
    expect(addSource).toHaveBeenCalledTimes(2);
    expect(addSource).toHaveBeenNthCalledWith(2, { feedUrl: c2.feedUrl });
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it('Discover shows only an icon, and reports that it is searching', () => {
    vi.mocked(discover).mockReturnValue(new Promise(() => {}));
    render(<AddSourceForm onAdded={vi.fn()} />);
    expectIconOnly(screen.getByRole('button', { name: 'Discover' }), 'Discover');
    fireEvent.change(screen.getByLabelText('Blog or feed URL'), {
      target: { value: 'https://a.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discover' }));
    expect(screen.getByRole('button', { name: 'Discovering' })).toBeDisabled();
  });
});
