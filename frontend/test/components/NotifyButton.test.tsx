import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { PushState } from '@/lib/push';
import { ApiError } from '@/lib/api';

const push = vi.hoisted(() => ({
  getPushState: vi.fn<() => Promise<PushState>>(),
  subscribe: vi.fn<() => Promise<PushState>>(),
  unsubscribe: vi.fn<() => Promise<PushState>>(),
  resync: vi.fn<() => Promise<void>>(),
}));
vi.mock('@/lib/push', () => push);

import NotifyButton from '@/components/NotifyButton';

const ON = 'Turn off notifications';
const OFF = 'Turn on new-post notifications';

async function mount(state: PushState) {
  push.getPushState.mockResolvedValue(state);
  await act(async () => {
    render(<NotifyButton />);
  });
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  push.resync.mockResolvedValue(undefined);
});

describe('NotifyButton', () => {
  it('renders nothing when hidden', async () => {
    await mount('hidden');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('off → subscribe → on', async () => {
    push.subscribe.mockResolvedValue('on');
    await mount('off');
    expect(screen.getByRole('button', { name: OFF })).toHaveAttribute('aria-pressed', 'false');
    await click(OFF);
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: ON })).toHaveAttribute('aria-pressed', 'true');
  });

  it('on → unsubscribe → off', async () => {
    push.unsubscribe.mockResolvedValue('off');
    await mount('on');
    await click(ON);
    expect(push.unsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: OFF })).toBeInTheDocument();
  });

  it('a failed subscribe reverts to off and shows the error', async () => {
    push.subscribe.mockRejectedValue(
      new ApiError(503, 'SUBSCRIPTIONS_FULL', 'Notification sign-ups are full right now.'),
    );
    await mount('off');
    await click(OFF);
    expect(screen.getByRole('button', { name: OFF })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Notification sign-ups are full right now.',
    );
  });

  it('blocked explains site settings instead of prompting', async () => {
    await mount('blocked');
    const btn = screen.getByRole('button');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.getByRole('dialog')).toHaveTextContent('Notifications are blocked for this site');
    expect(push.subscribe).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('needs-install shows the Home Screen steps', async () => {
    await mount('needs-install');
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('add feedzydev to your Home Screen first');
    expect(dialog).toHaveTextContent('Add to Home Screen');
    expect(push.subscribe).not.toHaveBeenCalled();
  });

  it('resyncs on load only when already on', async () => {
    await mount('on');
    expect(push.resync).toHaveBeenCalledTimes(1);
  });

  it('does not resync when off', async () => {
    await mount('off');
    expect(push.resync).not.toHaveBeenCalled();
  });

  it('is disabled while a click is pending', async () => {
    let finish: (s: PushState) => void = () => {};
    push.subscribe.mockReturnValue(new Promise<PushState>((r) => (finish = r)));
    await mount('off');
    await click(OFF);
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => finish('on'));
    expect(screen.getByRole('button', { name: ON })).toBeEnabled();
  });
});
