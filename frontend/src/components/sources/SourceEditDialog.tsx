'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CheckIcon, CloseIcon, SpinnerIcon } from '@/components/sources/icons';
import { ApiError, updateSource } from '@/lib/api';
import { MAX_NAME, MAX_POSTS, MAX_SHORT_NAME, MIN_POSTS } from '@/lib/settings';
import type { AdminSource, SourcePatch } from '@/lib/types';

const inputClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-border bg-bg px-3 text-sm placeholder:text-muted/60 disabled:opacity-60';

function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: (a11y: { id: string; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children({ id, ...(hint ? { 'aria-describedby': hintId } : {}) })}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export default function SourceEditDialog({
  source,
  defaultPosts,
  onCancel,
  onSaved,
}: {
  source: AdminSource;
  /** Global postsPerSource, shown as the placeholder when there is no override. */
  defaultPosts?: number;
  onCancel: () => void;
  /** `changed` is false when there was nothing to save. */
  onSaved: (changed: boolean) => void;
}) {
  const [name, setName] = useState(source.name);
  const [shortName, setShortName] = useState(source.shortName ?? '');
  const [feedUrl, setFeedUrl] = useState(source.feedUrl);
  const [posts, setPosts] = useState(source.postsPerSource?.toString() ?? '');
  const [enabled, setEnabled] = useState(source.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  /** The fields that changed, or a message saying what is wrong. */
  function buildPatch(): SourcePatch | string {
    const trimmedName = name.trim();
    if (!trimmedName) return 'Full name is required.';
    const trimmedUrl = feedUrl.trim();
    if (!trimmedUrl) return 'Source URL is required.';
    const rawPosts = posts.trim();
    const postsValue = rawPosts === '' ? null : Number(rawPosts);
    if (
      postsValue !== null &&
      !(Number.isInteger(postsValue) && postsValue >= MIN_POSTS && postsValue <= MAX_POSTS)
    ) {
      return `Posts must be a whole number from ${MIN_POSTS} to ${MAX_POSTS}.`;
    }
    const short = shortName.trim() || null;
    return {
      ...(trimmedName !== source.name ? { name: trimmedName } : {}),
      ...(short !== (source.shortName ?? null) ? { shortName: short } : {}),
      ...(trimmedUrl !== source.feedUrl ? { feedUrl: trimmedUrl } : {}),
      ...(postsValue !== (source.postsPerSource ?? null) ? { postsPerSource: postsValue } : {}),
      ...(enabled !== source.enabled ? { enabled } : {}),
    };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const patch = buildPatch();
    if (typeof patch === 'string') {
      setError(patch);
      return;
    }
    if (Object.keys(patch).length === 0) {
      onSaved(false);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await updateSource(source.sourceId, patch);
      onSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // The parent closes this by unmounting it, and a save in progress cannot be interrupted.
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-xl border border-border bg-surface p-4 text-text backdrop:bg-black/60 sm:p-5"
    >
      <h2 id={titleId} className="mb-4 truncate font-mono text-sm font-semibold">
        Edit {source.name}
      </h2>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          {(a11y) => (
            <input
              {...a11y}
              value={name}
              maxLength={MAX_NAME}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Short name" hint="Shown on post tags and in the sources filter.">
          {(a11y) => (
            <input
              {...a11y}
              value={shortName}
              maxLength={MAX_SHORT_NAME}
              placeholder={name.trim().slice(0, MAX_SHORT_NAME)}
              disabled={busy}
              onChange={(e) => setShortName(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Field
          label="Source URL"
          hint="The RSS or Atom feed address we crawl."
          className="sm:col-span-2"
        >
          {(a11y) => (
            <input
              {...a11y}
              type="url"
              inputMode="url"
              spellCheck={false}
              value={feedUrl}
              disabled={busy}
              onChange={(e) => setFeedUrl(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>
        <Field label="Posts to crawl" hint="Leave blank to use the default from crawl settings.">
          {(a11y) => (
            <input
              {...a11y}
              type="number"
              inputMode="numeric"
              min={MIN_POSTS}
              max={MAX_POSTS}
              value={posts}
              placeholder={defaultPosts?.toString() ?? ''}
              disabled={busy}
              onChange={(e) => setPosts(e.target.value)}
              className={`${inputClass} font-mono sm:w-28`}
            />
          )}
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm font-medium sm:mt-7">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-5 shrink-0 accent-[var(--fz-accent)]"
          />
          Enabled
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-500 sm:col-span-2">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button
            type="submit"
            aria-label={busy ? 'Saving' : 'Save'}
            title={busy ? 'Saving' : 'Save'}
            disabled={busy}
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg bg-accent text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <SpinnerIcon /> : <CheckIcon />}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Cancel"
            title="Cancel"
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-lg border border-border text-muted transition-colors hover:text-text disabled:opacity-50"
          >
            <CloseIcon />
          </button>
        </div>
      </form>
    </dialog>
  );
}
