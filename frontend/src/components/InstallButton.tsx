'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Chromium's install prompt event; not in the DOM typings.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const noop = () => () => {};

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iOS/iPadOS have no install prompt; the user adds the app from the Share menu. */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

const btn =
  'inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:text-accent';

export default function InstallButton() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent>();
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Read on the client only; the static HTML renders without the button.
  const standalone = useSyncExternalStore(noop, isStandalone, () => true);
  const ios = useSyncExternalStore(noop, isIos, () => false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event so the button can show the prompt later
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(undefined);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!showHelp) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowHelp(false);
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setShowHelp(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [showHelp]);

  if (standalone || installed || (!prompt && !ios)) return null;

  async function install() {
    if (!prompt) {
      setShowHelp((v) => !v);
      return;
    }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // A prompt event can only be used once.
    setPrompt(undefined);
    if (outcome === 'accepted') setInstalled(true);
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => void install()}
        aria-label="Install app"
        title="Install app"
        aria-expanded={prompt ? undefined : showHelp}
        aria-controls={prompt ? undefined : 'install-help'}
        className={btn}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
      </button>
      {showHelp && (
        <div
          id="install-help"
          role="dialog"
          aria-label="Install on iPhone or iPad"
          className="absolute top-12 right-0 z-30 w-64 rounded-xl border border-border bg-surface p-4 text-sm shadow-xl"
        >
          <p className="font-medium">Install feedzydev</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>
              Tap <span className="font-medium text-text">Share</span>{' '}
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="inline align-[-2px] text-accent"
              >
                <path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
              </svg>{' '}
              in the browser toolbar.
            </li>
            <li>
              Choose <span className="font-medium text-text">Add to Home Screen</span>.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
