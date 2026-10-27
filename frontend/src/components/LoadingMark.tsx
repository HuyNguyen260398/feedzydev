// Branded loading visual (terminal logo, blinking cursor, progress bar), shared by the first-load
// splash and the feed while a search or filter loads. Purely decorative; callers own the status role.
export default function LoadingMark() {
  return (
    <>
      <div aria-hidden="true" className="font-mono text-2xl font-semibold sm:text-3xl">
        {'> feedzy'}
        <span className="text-accent">dev</span>
        <span className="fz-splash-cursor text-accent">_</span>
      </div>
      <div aria-hidden="true" className="h-1 w-40 overflow-hidden rounded-full bg-border">
        <div className="fz-splash-bar h-full w-1/3 rounded-full bg-accent" />
      </div>
    </>
  );
}
