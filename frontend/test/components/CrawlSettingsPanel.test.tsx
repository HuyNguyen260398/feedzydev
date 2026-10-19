import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrawlSettingsPanel from '@/components/sources/CrawlSettingsPanel';
import { getSettings, saveSettings } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const loaded = {
  postsPerSource: 5,
  crawlHours: [7],
  retentionDays: 90,
  timezone: 'Asia/Ho_Chi_Minh',
};

beforeEach(() => {
  vi.mocked(getSettings).mockReset().mockResolvedValue(loaded);
  vi.mocked(saveSettings)
    .mockReset()
    .mockImplementation(async (s) => ({ ...loaded, ...s }));
});

const hour = (label: string) => screen.getByRole('button', { name: label });
const saveBtn = () => screen.getByRole('button', { name: 'Save settings' });

describe('CrawlSettingsPanel', () => {
  it('loads settings, reports them, and starts clean', async () => {
    const onLoaded = vi.fn();
    render(<CrawlSettingsPanel onLoaded={onLoaded} />);
    expect(await screen.findByLabelText('Posts per source')).toHaveValue(5);
    expect(hour('7 AM')).toHaveAttribute('aria-pressed', 'true');
    expect(hour('8 AM')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Crawls every day at 7 AM\./)).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    expect(onLoaded).toHaveBeenCalledWith(loaded);
  });

  it('saves the edited posts count and sorted hours', async () => {
    const onLoaded = vi.fn();
    render(<CrawlSettingsPanel onLoaded={onLoaded} />);
    fireEvent.change(await screen.findByLabelText('Posts per source'), {
      target: { value: '10' },
    });
    fireEvent.click(hour('1 PM'));
    fireEvent.click(hour('8 AM'));
    fireEvent.click(hour('7 AM'));
    expect(screen.getByText(/Crawls every day at 8 AM and 1 PM\./)).toBeInTheDocument();
    fireEvent.click(saveBtn());
    await screen.findByText('Saved.');
    expect(saveSettings).toHaveBeenCalledWith({
      postsPerSource: 10,
      crawlHours: [8, 13],
      retentionDays: 90,
    });
    expect(onLoaded).toHaveBeenLastCalledWith(expect.objectContaining({ postsPerSource: 10 }));
    expect(saveBtn()).toBeDisabled();
  });

  it('edits retention, warning when it gets shorter', async () => {
    render(<CrawlSettingsPanel />);
    const retention = await screen.findByLabelText('Keep posts for');
    expect(retention).toHaveValue('90');
    expect(screen.getByText(/more than 90 days ago are deleted/)).toBeInTheDocument();
    fireEvent.change(retention, { target: { value: '30' } });
    expect(screen.getByText(/removed within the hour/)).toBeInTheDocument();
    fireEvent.change(retention, { target: { value: '0' } });
    expect(screen.getByText('Posts are kept forever.')).toBeInTheDocument();
    fireEvent.click(saveBtn());
    await screen.findByText('Saved.');
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ retentionDays: 0 }));
  });

  it('lists a non-preset saved retention', async () => {
    vi.mocked(getSettings).mockResolvedValue({ ...loaded, retentionDays: 45 });
    render(<CrawlSettingsPanel />);
    expect(await screen.findByLabelText('Keep posts for')).toHaveValue('45');
    expect(screen.getByRole('option', { name: '45 days' })).toBeInTheDocument();
  });

  it('no hours selected means auto-crawl off', async () => {
    render(<CrawlSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '7 AM' }));
    expect(screen.getByText(/Automatic crawling is off/)).toBeInTheDocument();
    expect(saveBtn()).toBeEnabled();
  });

  it('blocks saving an out-of-range posts count', async () => {
    render(<CrawlSettingsPanel />);
    const posts = await screen.findByLabelText('Posts per source');
    for (const v of ['0', '51', '2.5', '']) {
      fireEvent.change(posts, { target: { value: v } });
      expect(saveBtn()).toBeDisabled();
    }
    expect(screen.getByText('Enter a whole number from 1 to 50.')).toBeInTheDocument();
  });

  it('shows load errors', async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error('x'));
    render(<CrawlSettingsPanel />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load settings.'),
    );
  });
});
