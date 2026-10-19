import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import InstallButton from '@/components/InstallButton';

const realUA = navigator.userAgent;

function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

function firePrompt() {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

afterEach(() => setUA(realUA));

describe('InstallButton', () => {
  it('is hidden until the browser offers an install prompt', () => {
    render(<InstallButton />);
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
  });

  it('shows the native prompt and hides once accepted', async () => {
    render(<InstallButton />);
    const e = firePrompt();
    expect(e.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
    });
    expect(e.prompt).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
  });

  it('on iOS explains Add to Home Screen; Escape closes it', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15');
    render(<InstallButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Add to Home Screen');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
