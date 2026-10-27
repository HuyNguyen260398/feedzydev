import LoadingMark from '@/components/LoadingMark';

// Stands in for the post list while a first page loads, e.g. after a search or filter change.
export default function FeedLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading posts"
      className="fz-feed-loading flex min-h-[50vh] flex-col items-center justify-center gap-5"
    >
      <LoadingMark />
    </div>
  );
}
