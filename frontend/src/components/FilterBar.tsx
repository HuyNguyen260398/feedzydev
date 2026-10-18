import type { ReactNode } from 'react';
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

export default function FilterBar({
  sources,
  sourceId,
  range,
  onSourceChange,
  onRangeChange,
}: {
  sources: PublicSource[];
  sourceId?: string;
  range: DateRange;
  onSourceChange(id?: string): void;
  onRangeChange(range: DateRange): void;
}) {
  const sorted = [...sources].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = sourceId !== undefined || range !== 'any';
  return (
    <div role="group" aria-label="Filter posts" className="flex flex-wrap items-center gap-2">
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
          }}
          className="min-h-11 cursor-pointer rounded-lg px-3 font-mono text-sm text-muted transition-colors duration-200 hover:text-accent"
        >
          Clear
        </button>
      )}
    </div>
  );
}
