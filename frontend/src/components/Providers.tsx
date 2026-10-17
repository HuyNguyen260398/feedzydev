'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/lib/theme';
import { configureAmplify } from '@/lib/auth';

export default function Providers({ children }: { children: ReactNode }) {
  // Configure Amplify once on the client, before children's effects (useAuth) run.
  if (typeof window !== 'undefined') configureAmplify();
  useEffect(() => configureAmplify(), []);
  return <ThemeProvider>{children}</ThemeProvider>;
}
