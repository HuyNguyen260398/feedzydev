import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SourcesPage from '@/app/sources/page';
import { getSettings, listAdminSources, triggerCrawl } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { expectIconOnly } from '../helpers';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getSettings: vi.fn(),
  listAdminSources: vi.fn(),
  triggerCrawl: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ status: 'signedIn', email: 'owner@example.com' }),
  signOut: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(listAdminSources).mockReset().mockResolvedValue([]);
  vi.mocked(getSettings)
    .mockReset()
    .mockResolvedValue({
      postsPerSource: 5,
      crawlHours: [7],
      retentionDays: 90,
      timezone: 'Asia/Ho_Chi_Minh',
    });
  vi.mocked(triggerCrawl).mockReset().mockResolvedValue(undefined);
  vi.mocked(signOut).mockReset();
});

describe('SourcesPage icon buttons', () => {
  it('Crawl now shows only an icon and starts a crawl', async () => {
    render(<SourcesPage />);
    const crawl = screen.getByRole('button', { name: 'Crawl now' });
    expectIconOnly(crawl, 'Crawl now');
    fireEvent.click(crawl);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Crawl started'));
    expect(triggerCrawl).toHaveBeenCalledTimes(1);
  });

  it('Crawl now reports that it is starting while the request runs', () => {
    vi.mocked(triggerCrawl).mockReturnValue(new Promise(() => {}));
    render(<SourcesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Crawl now' }));
    expect(screen.getByRole('button', { name: 'Starting crawl' })).toBeDisabled();
  });

  it('Sign out shows only an icon and signs out', () => {
    render(<SourcesPage />);
    const button = screen.getByRole('button', { name: 'Sign out' });
    expectIconOnly(button, 'Sign out');
    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
