'use client';

import { useEffect, useState } from 'react';

// Keep the splash up at least this long after navigation start so it doesn't just flicker.
const MIN_VISIBLE_MS = 500;
export const FADE_MS = 300;

type Phase = 'visible' | 'leaving' | 'gone';

// Full-page loading screen for the first load / refresh. It is in the static HTML, so it paints
// before any JS runs; once the page has loaded and hydrated it fades out and unmounts. Client-side
// navigation never shows it again because the root layout doesn't remount.
export default function SplashScreen() {
  const [phase, setPhase] = useState<Phase>('visible');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leave = () => {
      timer = setTimeout(
        () => setPhase('leaving'),
        Math.max(0, MIN_VISIBLE_MS - performance.now()),
      );
    };
    if (document.readyState === 'complete') leave();
    else window.addEventListener('load', leave, { once: true });
    return () => {
      window.removeEventListener('load', leave);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading feedzydev"
      className={`fz-splash fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-bg transition-opacity ease-out ${
        phase === 'leaving' ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div aria-hidden="true" className="font-mono text-2xl font-semibold sm:text-3xl">
        {'> feedzy'}
        <span className="text-accent">dev</span>
        <span className="fz-splash-cursor text-accent">_</span>
      </div>
      <div aria-hidden="true" className="h-1 w-40 overflow-hidden rounded-full bg-border">
        <div className="fz-splash-bar h-full w-1/3 rounded-full bg-accent" />
      </div>
    </div>
  );
}
