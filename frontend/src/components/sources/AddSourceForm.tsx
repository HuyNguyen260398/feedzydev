'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, addSource, discover } from '@/lib/api';
import { formatPostTime } from '@/lib/time';
import type { FeedCandidate } from '@/lib/types';

const messageOf = (e: unknown): string =>
  e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';

export default function AddSourceForm({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [candidates, setCandidates] = useState<FeedCandidate[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onDiscover(e: FormEvent) {
    e.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(undefined);
    setNotes({});
    try {
      const found = await discover(url.trim());
      setCandidates(found);
      setChecked(new Set(found.map((c) => c.feedUrl)));
    } catch (err) {
      setCandidates([]);
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAddSelected() {
    setBusy(true);
    setError(undefined);
    const remaining: FeedCandidate[] = [];
    const nextNotes: Record<string, string> = {};
    const nextChecked = new Set<string>();
    let added = 0;
    for (const c of candidates) {
      if (!checked.has(c.feedUrl)) {
        remaining.push(c);
        continue;
      }
      try {
        await addSource({ feedUrl: c.feedUrl });
        added++;
      } catch (err) {
        remaining.push(c);
        if (err instanceof ApiError && err.status === 409) {
          nextNotes[c.feedUrl] = 'Already added';
        } else {
          nextNotes[c.feedUrl] = messageOf(err);
          nextChecked.add(c.feedUrl);
        }
      }
    }
    const failed = remaining.filter((c) => nextNotes[c.feedUrl]);
    if (failed.length === 0) {
      setCandidates([]);
      setChecked(new Set());
      setNotes({});
      setUrl('');
    } else {
      setCandidates(failed);
      setChecked(nextChecked);
      setNotes(nextNotes);
    }
    setBusy(false);
    if (added > 0) onAdded();
  }

  function toggle(feedUrl: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(feedUrl)) next.add(feedUrl);
      return next;
    });
  }

  const now = new Date();
  const btn =
    'min-h-11 cursor-pointer rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section aria-label="Add source" className="rounded-xl border border-border bg-surface p-4">
      <form onSubmit={onDiscover} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/blog or feed URL"
          aria-label="Blog or feed URL"
          disabled={busy}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 font-mono text-sm placeholder:text-muted disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy}
          className={`${btn} bg-accent text-bg hover:opacity-90`}
        >
          Discover
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-4 space-y-3">
          <ul className="space-y-2">
            {candidates.map((c) => {
              const note = notes[c.feedUrl];
              const dupe = note === 'Already added';
              return (
                <li key={c.feedUrl} className="rounded-lg border border-border bg-bg p-3">
                  <label className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked.has(c.feedUrl)}
                      disabled={busy || dupe}
                      onChange={() => toggle(c.feedUrl)}
                      className="mt-1 size-5 shrink-0 accent-[var(--fz-accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span className="font-semibold">{c.title}</span>
                        {note && (
                          <span
                            className={`font-mono text-xs ${dupe ? 'text-muted' : 'text-red-500'}`}
                          >
                            {note}
                          </span>
                        )}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted">
                        {c.feedUrl}
                      </span>
                      {c.preview.length > 0 && (
                        <span className="mt-2 block space-y-0.5 text-xs text-muted">
                          {c.preview.slice(0, 3).map((p, i) => (
                            <span key={i} className="flex justify-between gap-3">
                              <span className="truncate">{p.title}</span>
                              {p.publishedAt && (
                                <span className="shrink-0 font-mono">
                                  {formatPostTime(p.publishedAt, now)}
                                </span>
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => void onAddSelected()}
            disabled={busy || checked.size === 0}
            className={`${btn} w-full bg-accent text-bg hover:opacity-90 sm:w-auto`}
          >
            {`Add selected (${checked.size})`}
          </button>
        </div>
      )}
    </section>
  );
}
