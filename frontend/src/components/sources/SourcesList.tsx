import SourceRow, { ROW_GRID } from '@/components/sources/SourceRow';
import type { AdminSource } from '@/lib/types';

export default function SourcesList({
  sources,
  defaultPosts,
  onChange,
}: {
  sources: AdminSource[];
  defaultPosts?: number;
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
        className={`hidden ${ROW_GRID} gap-4 border-b border-border px-2 pb-2 font-mono text-xs tracking-wide text-muted uppercase md:grid`}
      >
        <span>Source</span>
        <span>Last crawl</span>
        <span className="text-center">Posts</span>
        <span>On</span>
        <span />
      </div>
      <ul className="space-y-3 md:space-y-0">
        {sources.map((s) => (
          <SourceRow key={s.sourceId} source={s} defaultPosts={defaultPosts} onChange={onChange} />
        ))}
      </ul>
    </div>
  );
}
