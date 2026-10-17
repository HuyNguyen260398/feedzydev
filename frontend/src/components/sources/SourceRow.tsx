'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ApiError, deleteSource, updateSource } from '@/lib/api';
import { formatPostTime } from '@/lib/time';
import type { AdminSource } from '@/lib/types';

const CONFIRM_MS = 5000;

export default function SourceRow({
  source,
  onChange,
}: {
  source: AdminSource;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source.name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const settled = useRef(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    settled.current = false;
    setDraft(source.name);
    setEditing(true);
  }

  function commit() {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const name = draft.trim();
    if (!name || name === source.name) return;
    void run(() => updateSource(source.sourceId, { name }));
  }

  function cancel() {
    settled.current = true;
    setEditing(false);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') cancel();
  }

  const failed = source.lastStatus === 'error';
  const when = source.lastCrawledAt ? formatPostTime(source.lastCrawledAt, new Date()) : undefined;

  return (
    <li className="rounded-xl border border-border bg-surface p-3 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto_auto] md:items-center md:gap-4 md:rounded-none md:border-0 md:border-b md:bg-transparent md:px-2">
      <div className="min-w-0">
        {editing ? (
          <input
            autoFocus
            aria-label="Source name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={commit}
            className="min-h-11 w-full rounded-lg border border-accent bg-bg px-2 text-sm font-semibold"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Rename ${source.name}`}
            title="Click to rename"
            className="block min-h-11 max-w-full cursor-text truncate rounded-lg px-2 text-left text-sm font-semibold hover:bg-bg"
          >
            {source.name}
          </button>
        )}
        <a
          href={source.feedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 min-w-0 items-center px-2 font-mono text-xs text-muted hover:text-accent"
        >
          <span className="truncate">{source.feedUrl}</span>
        </a>
      </div>

      <div className="mt-2 min-w-0 px-2 font-mono text-xs md:mt-0">
        {failed ? (
          <details>
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-red-500">
              error{when ? ` · ${when}` : ''}
            </summary>
            <p className="mt-1 break-words text-muted">{source.lastError}</p>
          </details>
        ) : source.lastStatus === 'ok' ? (
          <span className="text-muted">
            {`ok · ${source.lastNewCount ?? 0} new${when ? ` · ${when}` : ''}`}
          </span>
        ) : (
          <span className="text-muted">not crawled yet</span>
        )}
        {error && (
          <p role="alert" className="mt-1 text-red-500">
            {error}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 md:mt-0 md:contents">
        <button
          type="button"
          role="switch"
          aria-checked={source.enabled}
          aria-label={`${source.enabled ? 'Disable' : 'Enable'} ${source.name}`}
          disabled={busy}
          onClick={() =>
            void run(() => updateSource(source.sourceId, { enabled: !source.enabled }))
          }
          className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className={`relative block h-6 w-11 rounded-full border border-border transition-colors ${
              source.enabled ? 'bg-accent' : 'bg-bg'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-4 rounded-full transition-transform ${
                source.enabled ? 'translate-x-5 bg-bg' : 'bg-muted'
              }`}
            />
          </span>
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!confirming) setConfirming(true);
            else {
              setConfirming(false);
              void run(() => deleteSource(source.sourceId));
            }
          }}
          className={`min-h-11 cursor-pointer rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
            confirming
              ? 'border-red-500 bg-red-500/10 text-red-500'
              : 'border-border text-muted hover:border-red-500 hover:text-red-500'
          }`}
        >
          {confirming ? 'Confirm delete?' : 'Delete'}
        </button>
      </div>
    </li>
  );
}
