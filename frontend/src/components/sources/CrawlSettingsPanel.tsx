'use client';

import { useEffect, useState } from 'react';
import { ApiError, getSettings, saveSettings } from '@/lib/api';
import { MAX_POSTS, MIN_POSTS } from '@/lib/settings';
import { formatHour, zoneOffsetLabel } from '@/lib/time';
import type { CrawlSettings } from '@/lib/types';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function describeHours(hours: number[]): string {
  if (hours.length === 0) return 'Automatic crawling is off — use “Crawl now”.';
  const labels = hours.map(formatHour);
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `Crawls every day at ${list}.`;
}

export default function CrawlSettingsPanel({
  onLoaded,
}: {
  onLoaded?: (s: CrawlSettings) => void;
}) {
  const [saved, setSaved] = useState<CrawlSettings>();
  const [posts, setPosts] = useState('');
  const [hours, setHours] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let live = true;
    getSettings().then(
      (s) => {
        if (!live) return;
        setSaved(s);
        setPosts(String(s.postsPerSource));
        setHours(s.crawlHours);
        onLoaded?.(s);
      },
      (e: unknown) =>
        live && setError(e instanceof ApiError ? e.message : 'Could not load settings.'),
    );
    return () => {
      live = false;
    };
  }, [onLoaded]);

  const postsNum = Number(posts);
  const postsValid = Number.isInteger(postsNum) && postsNum >= MIN_POSTS && postsNum <= MAX_POSTS;
  const dirty =
    !!saved && (postsNum !== saved.postsPerSource || hours.join() !== saved.crawlHours.join());

  function toggle(h: number) {
    setNotice(undefined);
    setHours((cur) =>
      cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h].sort((a, b) => a - b),
    );
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const s = await saveSettings({ postsPerSource: postsNum, crawlHours: hours });
      setSaved(s);
      setHours(s.crawlHours);
      onLoaded?.(s);
      setNotice('Saved.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="crawl-settings"
      className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <h2 id="crawl-settings" className="font-mono text-sm font-semibold">
        <span className="text-accent">$</span> crawl settings
      </h2>

      {!saved && !error && <div className="h-28 animate-pulse rounded-lg bg-bg" />}

      {saved && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="posts-per-source" className="block text-sm font-medium">
              Posts per source
            </label>
            <input
              id="posts-per-source"
              type="number"
              inputMode="numeric"
              min={MIN_POSTS}
              max={MAX_POSTS}
              value={posts}
              onChange={(e) => {
                setNotice(undefined);
                setPosts(e.target.value);
              }}
              aria-invalid={!postsValid}
              aria-describedby="posts-hint"
              className={`min-h-11 w-28 rounded-lg border bg-bg px-3 font-mono text-sm ${
                postsValid ? 'border-border' : 'border-red-500'
              }`}
            />
            <p id="posts-hint" className={`text-xs ${postsValid ? 'text-muted' : 'text-red-500'}`}>
              {postsValid
                ? 'Newest posts taken from each source per crawl. A source can override this below.'
                : `Enter a whole number from ${MIN_POSTS} to ${MAX_POSTS}.`}
            </p>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Daily crawl times</legend>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:grid-cols-12">
              {HOURS.map((h) => {
                const on = hours.includes(h);
                return (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(h)}
                    className={`min-h-11 cursor-pointer rounded-lg border font-mono text-xs whitespace-nowrap transition-colors duration-200 ${
                      on
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border bg-bg text-muted hover:border-accent/50 hover:text-text'
                    }`}
                  >
                    {formatHour(h)}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted">
              {describeHours(hours)} Times are {saved.timezone.replace(/_/g, ' ')} (
              {zoneOffsetLabel(saved.timezone)}).
            </p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || !postsValid || busy}
              className="min-h-11 cursor-pointer rounded-lg border border-accent bg-accent/15 px-4 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save settings'}
            </button>
            {notice && (
              <p role="status" className="font-mono text-xs text-accent">
                {notice}
              </p>
            )}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </section>
  );
}
