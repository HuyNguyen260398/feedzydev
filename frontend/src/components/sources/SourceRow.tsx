'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, deleteSource, updateSource } from '@/lib/api';
import SourceEditDialog from '@/components/sources/SourceEditDialog';
import { PencilIcon, TrashIcon } from '@/components/sources/icons';
import { formatPostTime } from '@/lib/time';
import type { AdminSource } from '@/lib/types';

const CONFIRM_MS = 5000;

export const ROW_GRID = 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_4rem_2.75rem_6rem]';

export default function SourceRow({
  source,
  defaultPosts,
  onChange,
}: {
  source: AdminSource;
  /** Global postsPerSource, shown as the placeholder when there is no override. */
  defaultPosts?: number;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirming]);

  // The dialog closes by unmounting, so the browser does not restore focus by itself.
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    editButton.current?.focus();
  }, [editing]);

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

  function closeDialog() {
    returnFocus.current = true;
    setEditing(false);
  }

  const failed = source.lastStatus === 'error';
  const when = source.lastCrawledAt ? formatPostTime(source.lastCrawledAt, new Date()) : undefined;

  return (
    <li
      className={`rounded-xl border border-border bg-surface p-3 md:grid ${ROW_GRID} md:items-center md:gap-4 md:rounded-none md:border-0 md:border-b md:bg-transparent md:px-2`}
    >
      <div className="min-w-0">
        <div className="flex min-h-11 min-w-0 items-center gap-2 px-2">
          <span className="truncate text-sm font-semibold">{source.name}</span>
          {source.shortName && (
            <span className="max-w-[45%] shrink-0 truncate rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-xs text-accent">
              {source.shortName}
            </span>
          )}
        </div>
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
        <p className="flex items-center gap-2 font-mono text-xs text-muted md:w-16 md:justify-center">
          <span className="md:sr-only">Posts</span>
          <span
            title={
              source.postsPerSource !== undefined
                ? 'Set for this source'
                : 'Uses the default from crawl settings'
            }
            className={source.postsPerSource !== undefined ? 'text-sm text-accent' : 'text-sm'}
          >
            {source.postsPerSource ?? defaultPosts ?? '–'}
          </span>
        </p>
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

        <div className="flex items-center justify-end gap-2 md:w-24">
          <button
            ref={editButton}
            type="button"
            disabled={busy}
            onClick={() => {
              setError(undefined);
              setEditing(true);
            }}
            aria-label={`Edit ${source.name}`}
            title="Edit"
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <PencilIcon />
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
            aria-label={`${confirming ? 'Confirm delete' : 'Delete'} ${source.name}`}
            title={confirming ? 'Click again to delete' : 'Delete'}
            className={`inline-flex size-11 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
              confirming
                ? 'border-red-500 bg-red-500 text-white'
                : 'border-border text-muted hover:border-red-500 hover:text-red-500'
            }`}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {editing && (
        <SourceEditDialog
          source={source}
          defaultPosts={defaultPosts}
          onCancel={closeDialog}
          onSaved={(changed) => {
            closeDialog();
            if (changed) onChange();
          }}
        />
      )}
    </li>
  );
}
