export default function SkeletonCard({ featured = false }: { featured?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`flex h-full animate-pulse overflow-hidden rounded-xl border border-border bg-surface ${
        featured ? 'flex-col' : 'flex-row sm:flex-col'
      }`}
    >
      <div
        className={`aspect-video bg-border/70 ${featured ? 'w-full' : 'w-32 shrink-0 self-start sm:w-full'}`}
      />
      <div className={`flex flex-1 flex-col gap-2.5 ${featured ? 'p-5' : 'p-3 sm:p-4'}`}>
        <div className="flex justify-between gap-2">
          <div className="h-4 w-20 rounded bg-border" />
          <div className="h-4 w-12 rounded bg-border" />
        </div>
        <div className={`rounded bg-border ${featured ? 'h-7 w-11/12' : 'h-4 w-full'}`} />
        <div className={`rounded bg-border ${featured ? 'h-7 w-2/3' : 'h-4 w-3/4'}`} />
      </div>
    </div>
  );
}
