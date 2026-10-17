import type { PublicSource } from '@/lib/types';

function Chip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border px-4 font-mono text-sm whitespace-nowrap transition-colors duration-200 ${
        pressed
          ? 'border-accent bg-accent/15 text-accent shadow-[0_0_16px_-6px_var(--fz-accent)]'
          : 'border-border bg-surface text-muted hover:border-accent/50 hover:text-text'
      }`}
    >
      {label}
    </button>
  );
}

export default function FilterChips({
  sources,
  value,
  onChange,
}: {
  sources: PublicSource[];
  value?: string;
  onChange(id?: string): void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by source"
      className="-mx-3 flex flex-nowrap gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:thin] sm:-mx-4 sm:px-4"
    >
      <Chip label="All" pressed={value === undefined} onClick={() => onChange(undefined)} />
      {sources.map((s) => (
        <Chip
          key={s.sourceId}
          label={s.name}
          pressed={value === s.sourceId}
          onClick={() => onChange(s.sourceId)}
        />
      ))}
    </div>
  );
}
