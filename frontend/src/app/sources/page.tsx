'use client';

import { useCallback, useEffect, useState } from 'react';
import ErrorBanner from '@/components/ErrorBanner';
import AddSourceForm from '@/components/sources/AddSourceForm';
import CrawlSettingsPanel from '@/components/sources/CrawlSettingsPanel';
import SignInPanel from '@/components/sources/SignInPanel';
import SourcesList from '@/components/sources/SourcesList';
import { ApiError, listAdminSources, triggerCrawl } from '@/lib/api';
import { signOut, useAuth } from '@/lib/auth';
import type { AdminSource, CrawlSettings } from '@/lib/types';

const btn =
  'min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-4 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50';

function Skeleton() {
  return (
    <div role="status" aria-label="Loading sources" className="space-y-3">
      <div className="h-8 w-48 animate-pulse rounded bg-surface" />
      <div className="h-24 animate-pulse rounded-xl bg-surface" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}

export default function SourcesPage() {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn';
  const [sources, setSources] = useState<AdminSource[]>();
  const [error, setError] = useState<string>();
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [crawling, setCrawling] = useState(false);
  const [defaultPosts, setDefaultPosts] = useState<number>();
  const onSettings = useCallback((s: CrawlSettings) => setDefaultPosts(s.postsPerSource), []);

  const load = useCallback(async () => {
    try {
      return { items: await listAdminSources() };
    } catch (e) {
      return { failure: e };
    }
  }, []);

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    if (r.items) {
      setSources(r.items);
      setError(undefined);
    } else if (r.failure instanceof ApiError && r.failure.status === 403) {
      setForbidden(true);
    } else {
      setError(r.failure instanceof ApiError ? r.failure.message : 'Could not load sources.');
    }
  }, []);

  const refresh = useCallback(() => void load().then(apply), [load, apply]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void load().then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [signedIn, load, apply]);

  async function crawl() {
    setCrawling(true);
    setNotice(undefined);
    try {
      await triggerCrawl();
      setNotice('Crawl started — refresh in a minute.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setForbidden(true);
      else setError(e instanceof ApiError ? e.message : 'Could not start the crawl.');
    } finally {
      setCrawling(false);
    }
  }

  if (auth.status === 'loading') return <Skeleton />;
  if (auth.status === 'signedOut') return <SignInPanel />;

  const signOutBtn = (
    <button type="button" onClick={() => void signOut()} className={btn}>
      Sign out
    </button>
  );

  if (forbidden) {
    return (
      <section className="mx-auto max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 text-center">
        <p role="alert" className="text-sm">
          This account isn&apos;t allowed to manage sources.
        </p>
        {signOutBtn}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-mono text-lg font-semibold">Sources</h1>
          <p className="truncate text-xs text-muted">{auth.email}</p>
        </div>
        {signOutBtn}
      </div>

      <AddSourceForm onAdded={() => refresh()} />

      <CrawlSettingsPanel onLoaded={onSettings} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void crawl()} disabled={crawling} className={btn}>
          Crawl now
        </button>
        {notice && (
          <p role="status" className="font-mono text-xs text-accent">
            {notice}
          </p>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => refresh()} />}

      {sources ? (
        <SourcesList sources={sources} defaultPosts={defaultPosts} onChange={() => refresh()} />
      ) : (
        !error && <Skeleton />
      )}
    </div>
  );
}
