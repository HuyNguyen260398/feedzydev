import Link from 'next/link';

export default function EmptyState({ filtered = false }: { filtered?: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center">
      <p className="font-mono text-sm text-muted">
        <span className="text-accent">$</span> feedzydev --list
      </p>
      {filtered ? (
        <p className="mt-3 text-base text-text">No posts match these filters.</p>
      ) : (
        <p className="mt-3 text-base text-text">
          No posts yet —{' '}
          <Link
            href="/sources/"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            add a source
          </Link>
        </p>
      )}
    </div>
  );
}
