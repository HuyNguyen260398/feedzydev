'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { DATE_RANGES, type DateRange } from '@/lib/time';
import type { PublicSource } from '@/lib/types';

function Select({
  label,
  value,
  active,
  onChange,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  onChange(value: string): void;
  children: ReactNode;
}) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`min-h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg border bg-surface py-2 pr-9 pl-3 font-mono text-sm transition-colors duration-200 sm:w-56 ${
          active
            ? 'border-accent text-accent shadow-[0_0_16px_-6px_var(--fz-accent)]'
            : 'border-border text-text hover:border-accent/50'
        }`}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 h-4 w-4 text-muted"
      >
        <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </label>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange(value: string): void }) {
  const input = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere on the page, unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const active = value.trim() !== '';
  return (
    <div
      role="search"
      className="relative flex min-w-0 basis-full items-center sm:min-w-56 sm:flex-1 sm:basis-auto"
    >
      <label htmlFor="post-search" className="sr-only">
        Search posts
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute left-3 h-4 w-4 text-muted"
      >
        <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        id="post-search"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        placeholder="Search titles or sources…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        className={`min-h-11 w-full min-w-0 rounded-lg border bg-surface py-2 pr-10 pl-9 font-mono text-sm transition-colors duration-200 placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none ${
          active
            ? 'border-accent shadow-[0_0_16px_-6px_var(--fz-accent)]'
            : 'border-border hover:border-accent/50'
        }`}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
          className="absolute right-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-200 hover:text-accent"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4">
            <path
              d="m5.5 5.5 9 9m0-9-9 9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function FilterBar({
  sources,
  sourceId,
  range,
  query = '',
  onSourceChange,
  onRangeChange,
  onQueryChange = () => {},
}: {
  sources: PublicSource[];
  sourceId?: string;
  range: DateRange;
  /** Raw search text as typed. */
  query?: string;
  onSourceChange(id?: string): void;
  onRangeChange(range: DateRange): void;
  onQueryChange?(query: string): void;
}) {
  const sorted = [...sources].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = sourceId !== undefined || range !== 'any' || query.trim() !== '';
  return (
    <div role="group" aria-label="Filter posts" className="flex flex-wrap items-center gap-2">
      <SearchBox value={query} onChange={onQueryChange} />
      <Select
        label="Source"
        value={sourceId ?? ''}
        active={sourceId !== undefined}
        onChange={(v) => onSourceChange(v || undefined)}
      >
        <option value="">All sources</option>
        {sorted.map((s) => (
          <option key={s.sourceId} value={s.sourceId}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select
        label="Published"
        value={range}
        active={range !== 'any'}
        onChange={(v) => onRangeChange(v as DateRange)}
      >
        {DATE_RANGES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      {filtered && (
        <button
          type="button"
          onClick={() => {
            onSourceChange(undefined);
            onRangeChange('any');
            onQueryChange('');
          }}
          className="min-h-11 cursor-pointer rounded-lg px-3 font-mono text-sm text-muted transition-colors duration-200 hover:text-accent"
        >
          Clear
        </button>
      )}
    </div>
  );
}
