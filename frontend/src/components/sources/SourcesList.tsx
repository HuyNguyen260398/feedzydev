import SourceRow from '@/components/sources/SourceRow';
import type { AdminSource } from '@/lib/types';

export default function SourcesList({
  sources,
  onChange,
}: {
  sources: AdminSource[];
  onChange: () => void;
}) {
  if (sources.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border py-10 text-center font-mono text-sm text-muted">
        No sources yet.
      </p>
    );
  }
  return (
    <div>
      <div
        aria-hidden="true"
        className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_auto_auto] gap-4 border-b border-border px-2 pb-2 font-mono text-xs tracking-wide text-muted uppercase md:grid"
      >
        <span>Source</span>
        <span>Last crawl</span>
        <span className="w-11">On</span>
        <span className="w-[8.5rem]" />
      </div>
      <ul className="space-y-3 md:space-y-0">
        {sources.map((s) => (
          <SourceRow key={s.sourceId} source={s} onChange={onChange} />
        ))}
      </ul>
    </div>
  );
}
