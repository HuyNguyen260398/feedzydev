import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SourceRow from '@/components/sources/SourceRow';
import { ApiError, deleteSource, updateSource } from '@/lib/api';
import type { AdminSource } from '@/lib/types';
import { expectIconOnly } from '../helpers';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
}));

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

const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true;
});

beforeEach(() => {
  // jsdom does not implement modal dialogs.
  showModal.mockClear();
  HTMLDialogElement.prototype.showModal = showModal;
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
    fireEvent.click(screen.getByRole('button', { name: 'Delete Kube Weekly' }));
    expect(deleteSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Kube Weekly' }));
    await waitFor(() => expect(deleteSource).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('delete confirm resets after 5s', () => {
    vi.useFakeTimers();
    render(<SourceRow source={source} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Kube Weekly' }));
    expect(screen.getByRole('button', { name: 'Confirm delete Kube Weekly' })).toBeInTheDocument();
    act5s();
    expect(screen.getByRole('button', { name: 'Delete Kube Weekly' })).toBeInTheDocument();
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
});

import { act } from '@testing-library/react';
function act5s() {
  act(() => {
    vi.advanceTimersByTime(5000);
  });
}

describe('SourceRow icon buttons', () => {
  it('Edit and Delete show only an icon, with a tooltip', () => {
    render(<SourceRow source={source} onChange={vi.fn()} />);
    expectIconOnly(screen.getByRole('button', { name: 'Edit Kube Weekly' }), 'Edit');
    expectIconOnly(screen.getByRole('button', { name: 'Delete Kube Weekly' }), 'Delete');
  });

  it('the armed Delete says what the next click does', () => {
    render(<SourceRow source={source} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Kube Weekly' }));
    expectIconOnly(
      screen.getByRole('button', { name: 'Confirm delete Kube Weekly' }),
      'Click again to delete',
    );
  });

  it('Save and Cancel show only an icon, with a tooltip', () => {
    render(<SourceRow source={source} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kube Weekly' }));
    expectIconOnly(screen.getByRole('button', { name: 'Save' }), 'Save');
    expectIconOnly(screen.getByRole('button', { name: 'Cancel' }), 'Cancel');
  });

  it('Save reports that it is saving while the request runs', async () => {
    vi.mocked(updateSource).mockReturnValue(new Promise(() => {}));
    render(<SourceRow source={source} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kube Weekly' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
  });
});

describe('SourceRow details', () => {
  it('shows the short name and the posts override', () => {
    render(
      <SourceRow source={{ ...source, shortName: 'K8s', postsPerSource: 3 }} onChange={vi.fn()} />,
    );
    expect(screen.getByText('K8s')).toBeInTheDocument();
    expect(screen.getByTitle('Set for this source')).toHaveTextContent('3');
  });

  it('shows the default posts number when there is no override', () => {
    render(<SourceRow source={source} defaultPosts={5} onChange={vi.fn()} />);
    expect(screen.getByTitle(/Uses the default/)).toHaveTextContent('5');
  });
});

describe('SourceRow edit form', () => {
  const edited: AdminSource = { ...source, shortName: 'K8s', postsPerSource: 3 };
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Edit Kube Weekly' }));
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  const type = (name: string, value: string) =>
    fireEvent.change(field(name), { target: { value } });
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  // Browsers turn Escape in a modal into a `cancel` event on the dialog.
  const pressEscape = () =>
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));

  it('opens as a modal named after the source, leaving the row in place behind it', () => {
    render(<SourceRow source={source} onChange={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    expect(showModal).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog', { name: 'Edit Kube Weekly' });
    expect(within(dialog).getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByText('ok · 3 new · 2h ago')).toBeInTheDocument();
  });

  it('opens with the current values of all five fields', () => {
    render(<SourceRow source={edited} onChange={vi.fn()} />);
    open();
    expect(field('Full name')).toHaveValue('Kube Weekly');
    expect(field('Short name')).toHaveValue('K8s');
    expect(field('Source URL')).toHaveValue('https://kube.example.com/feed.xml');
    expect(field('Posts to crawl')).toHaveValue(3);
    expect(field('Enabled')).toBeChecked();
  });

  it('saves all edited fields, trimmed, then closes and refreshes', async () => {
    const onChange = vi.fn();
    render(<SourceRow source={edited} onChange={onChange} />);
    open();
    type('Full name', '  Kubernetes Weekly ');
    type('Short name', ' K8sW ');
    type('Source URL', ' https://new.example.com/rss ');
    type('Posts to crawl', '7');
    fireEvent.click(field('Enabled'));
    save();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(updateSource).toHaveBeenCalledWith('s1', {
      name: 'Kubernetes Weekly',
      shortName: 'K8sW',
      feedUrl: 'https://new.example.com/rss',
      postsPerSource: 7,
      enabled: false,
    });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('sends only the fields that changed', async () => {
    render(<SourceRow source={edited} onChange={vi.fn()} />);
    open();
    type('Short name', 'KW');
    save();
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith('s1', { shortName: 'KW' }));
  });

  it('blanking the short name and posts clears them', async () => {
    render(<SourceRow source={edited} onChange={vi.fn()} />);
    open();
    type('Short name', '   ');
    type('Posts to crawl', '');
    save();
    await waitFor(() =>
      expect(updateSource).toHaveBeenCalledWith('s1', { shortName: null, postsPerSource: null }),
    );
  });

  it('leaving unset optional fields blank sends nothing', async () => {
    const onChange = vi.fn();
    render(<SourceRow source={source} defaultPosts={5} onChange={onChange} />);
    open();
    expect(field('Posts to crawl')).toHaveAttribute('placeholder', '5');
    save();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(updateSource).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['Full name', '   '],
    ['Source URL', '  '],
    ['Posts to crawl', '99'],
    ['Posts to crawl', '2.5'],
  ])('rejects %s = %j without saving', (name, value) => {
    render(<SourceRow source={source} onChange={vi.fn()} />);
    open();
    type(name, value);
    save();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(updateSource).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('keeps the form and the draft open when saving fails', async () => {
    vi.mocked(updateSource).mockRejectedValue(
      new ApiError(422, 'NOT_A_FEED', 'That URL does not look like an RSS/Atom feed.'),
    );
    const onChange = vi.fn();
    render(<SourceRow source={source} onChange={onChange} />);
    open();
    type('Source URL', 'https://nope.example.com/');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('does not look like');
    expect(field('Source URL')).toHaveValue('https://nope.example.com/');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Cancel and Escape discard the draft', () => {
    render(<SourceRow source={source} onChange={vi.fn()} />);
    open();
    type('Full name', 'Draft');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(updateSource).not.toHaveBeenCalled();
    open();
    expect(field('Full name')).toHaveValue('Kube Weekly');
    type('Full name', 'Draft');
    pressEscape();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Kube Weekly' })).toHaveFocus();
  });

  it('Escape does not close the modal while saving', async () => {
    let finish = () => {};
    vi.mocked(updateSource).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve({} as never);
      }),
    );
    const onChange = vi.fn();
    render(<SourceRow source={source} onChange={onChange} />);
    open();
    type('Full name', 'New');
    save();
    expect(pressEscape()).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    finish();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
