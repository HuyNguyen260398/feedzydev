'use client';

import { useEffect, useRef, useState } from 'react';

// Follows `active`, but once it turns on stays on for at least `minMs`, so a fast response doesn't
// just flash a loading indicator.
export function useMinVisible(active: boolean, minMs: number): boolean {
  const [held, setHeld] = useState(active);
  const shownAt = useRef(0);

  // Latch on during render the moment `active` turns on; only the turn-off is deferred.
  if (active && !held) setHeld(true);

  useEffect(() => {
    if (active) {
      shownAt.current = Date.now();
      return;
    }
    const timer = setTimeout(
      () => setHeld(false),
      Math.max(0, shownAt.current + minMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [active, minMs]);

  return active || held;
}
