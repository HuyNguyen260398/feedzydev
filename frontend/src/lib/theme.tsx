'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { THEME_COLORS } from '@/lib/themeColors';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'fz-theme';

interface ThemeValue {
  theme: Theme;
  toggle(): void;
}

const ThemeContext = createContext<ThemeValue>({ theme: 'dark', toggle: () => {} });

const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The <html> class is the source of truth; the pre-hydration script in layout sets it.
function getSnapshot(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function getServerSnapshot(): Theme {
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // storage unavailable; theme still applies for this session
    }
    listeners.forEach((fn) => fn());
  }, []);

  // Tint the browser / installed-app title bar to match.
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLORS[theme]);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
