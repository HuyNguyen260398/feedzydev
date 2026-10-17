'use client';

import { signIn } from '@/lib/auth';

export default function SignInPanel() {
  return (
    <section className="mx-auto max-w-sm rounded-xl border border-border bg-surface p-6 text-center">
      <p className="font-mono text-sm text-accent">{'$ sudo sources'}</p>
      <h1 className="mt-2 text-lg font-semibold">Manage sources</h1>
      <p className="mt-1 text-sm text-muted">Only the owner can manage sources.</p>
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
