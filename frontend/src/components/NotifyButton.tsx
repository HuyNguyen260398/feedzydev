'use client';

import { useEffect, useRef, useState } from 'react';
import IosInstallSteps from '@/components/IosInstallSteps';
import { getPushState, resync, subscribe, unsubscribe, type PushState } from '@/lib/push';

const btn =
  'inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:text-accent disabled:cursor-wait disabled:opacity-60';
const panelCls =
  'absolute top-12 right-0 z-30 w-64 rounded-xl border border-border bg-surface p-4 text-sm shadow-xl';

const LABELS: Record<Exclude<PushState, 'hidden'>, string> = {
  off: 'Turn on new-post notifications',
  on: 'Turn off notifications',
  blocked: 'Notifications are blocked',
  'needs-install': 'Get new-post notifications',
};

const BELL = 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0';

function Icon({ state, busy }: { state: PushState; busy: boolean }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (busy) {
    return (
      <svg {...common} fill="none" className="animate-spin">
        <path d="M21 12a9 9 0 1 1-6.2-8.56" />
      </svg>
    );
  }
  return (
    <svg {...common} fill={state === 'on' ? 'currentColor' : 'none'}>
      <path d={BELL} />
      {(state === 'blocked' || state === 'needs-install') && <path d="M3 3l18 18" />}
    </svg>
  );
}

type Panel = { kind: 'blocked' | 'needs-install' } | { kind: 'error'; message: string };

export default function NotifyButton() {
  const [state, setState] = useState<PushState>('hidden');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void getPushState().then((s) => {
      if (!live) return;
      setState(s);
      if (s === 'on') void resync();
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null);
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [panel]);

  if (state === 'hidden') return null;

  async function toggle() {
    if (state === 'blocked' || state === 'needs-install') {
      setPanel((p) => (p ? null : { kind: state }));
      return;
    }
    setPanel(null);
    setBusy(true);
    try {
      setState(state === 'on' ? await unsubscribe() : await subscribe());
    } catch (err) {
      setPanel({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not change notifications.',
      });
    } finally {
      setBusy(false);
    }
  }

  const label = LABELS[state];
  const toggleable = state === 'on' || state === 'off';
  const help = panel && panel.kind !== 'error';

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-label={label}
        title={label}
        aria-pressed={toggleable ? state === 'on' : undefined}
        aria-expanded={toggleable ? undefined : !!help}
        aria-controls={toggleable ? undefined : 'notify-help'}
        className={`${btn} ${state === 'on' ? 'text-accent' : ''}`}
      >
        <Icon state={state} busy={busy} />
      </button>
      {panel?.kind === 'needs-install' && (
        <div
          id="notify-help"
          role="dialog"
          aria-label="Notifications on iPhone or iPad"
          className={panelCls}
        >
          <p className="font-medium">
            To get notifications on iPhone/iPad, add feedzydev to your Home Screen first.
          </p>
          <IosInstallSteps />
        </div>
      )}
      {panel?.kind === 'blocked' && (
        <div id="notify-help" role="dialog" aria-label="Notifications blocked" className={panelCls}>
          <p>
            Notifications are blocked for this site. Enable them in your browser&apos;s site
            settings.
          </p>
        </div>
      )}
      {panel?.kind === 'error' && (
        <div role="status" className={panelCls}>
          {panel.message}
        </div>
      )}
    </div>
  );
}
