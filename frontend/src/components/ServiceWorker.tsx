'use client';

import { useEffect } from 'react';

/** Registers /sw.js in production builds; dev and mock runs stay cache-free. */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err: unknown) => {
      console.warn('Service worker registration failed', err);
    });
  }, []);
  return null;
}
