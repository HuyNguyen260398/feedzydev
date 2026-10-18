'use client';

import { useEffect, useState } from 'react';
import { signIn } from '@/lib/auth';

export default function SignInPanel() {
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('error_description') || params.has('error')) {
      // Deferred: the query string is external state; avoids a synchronous setState in the effect.
      queueMicrotask(() => setRejected(true));
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return (
    <section className="mx-auto max-w-sm rounded-xl border border-border bg-surface p-6 text-center">
      <p className="font-mono text-sm text-accent">{'$ sudo sources'}</p>
      <h1 className="mt-2 text-lg font-semibold">Manage sources</h1>
      <p className="mt-1 text-sm text-muted">Only the owner can manage sources.</p>
      {rejected && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          This app is private — only the owner can sign in.
        </p>
      )}
      <button
        type="button"
        onClick={() => void signIn()}
        className="mt-5 min-h-11 w-full cursor-pointer rounded-lg bg-accent px-4 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
      >
        Sign in with Google
      </button>
    </section>
  );
}
