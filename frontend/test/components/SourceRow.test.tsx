import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SourceRow from '@/components/sources/SourceRow';
import { deleteSource, updateSource } from '@/lib/api';
import type { AdminSource } from '@/lib/types';

vi.mock('@/lib/api', () => ({ updateSource: vi.fn(), deleteSource: vi.fn() }));

const source: AdminSource = {
  sourceId: 's1',
  name: 'Kube Weekly',
  siteUrl: 'https://kube.example.com',
  feedUrl: 'https://kube.example.com/feed.xml',
  enabled: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastCrawledAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  lastStatus: 'ok',
  lastNewCount: 3,
};

beforeEach(() => {
  vi.mocked(updateSource)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(deleteSource).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('SourceRow', () => {
  it('renders ok status line', () => {
    render(<SourceRow source={source} onChange={vi.fn()} />);
    expect(screen.getByText('ok · 3 new · 2h ago')).toBeInTheDocument();
  });

  it('toggle calls updateSource with enabled false', async () => {
    const onChange = vi.fn();
    render(<SourceRow source={source} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(updateSource).toHaveBeenCalledWith('s1', { enabled: false });
  });

  it('delete requires confirm click', async () => {
    const onChange = vi.fn();
    render(<SourceRow source={source} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete?' }));
    await waitFor(() => expect(deleteSource).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('delete confirm resets after 5s', () => {
    vi.useFakeTimers();
    render(<SourceRow source={source} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Confirm delete?' })).toBeInTheDocument();
    act5s();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders error status with lastError', () => {
    render(
      <SourceRow
        source={{ ...source, lastStatus: 'error', lastError: 'HTTP 500 from feed' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/^error/)).toBeInTheDocument();
    expect(screen.getByText('HTTP 500 from feed')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500 from feed').closest('details')).not.toBeNull();
  });

  it('rename saves on Enter, trimmed; unchanged/empty makes no call; Esc cancels', async () => {
    const onChange = vi.fn();
    render(<SourceRow source={source} onChange={onChange} />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: /Rename Kube Weekly/ }));

    open();
    let input = screen.getByRole('textbox', { name: 'Source name' });
    fireEvent.change(input, { target: { value: '  New Name ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith('s1', { name: 'New Name' }));

    vi.mocked(updateSource).mockClear();
    open();
    input = screen.getByRole('textbox', { name: 'Source name' });
    fireEvent.change(input, { target: { value: 'Other' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    open();
    input = screen.getByRole('textbox', { name: 'Source name' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    open();
    fireEvent.blur(screen.getByRole('textbox', { name: 'Source name' }));
    expect(updateSource).not.toHaveBeenCalled();
  });
});

import { act } from '@testing-library/react';
function act5s() {
  act(() => {
    vi.advanceTimersByTime(5000);
  });
}
