import Thumbnail from '@/components/Thumbnail';
import { formatFullTime, formatPostTime } from '@/lib/time';
import type { PublicPost } from '@/lib/types';

export default function PostCard({
  post,
  variant,
  now,
}: {
  post: PublicPost;
  variant: 'featured' | 'tile';
  now: Date;
}) {
  const featured = variant === 'featured';
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`fz-card group flex h-full overflow-hidden rounded-xl border border-border bg-surface ${
        featured ? 'flex-col' : 'flex-row sm:flex-col'
      }`}
    >
      <Thumbnail
        src={post.thumbnailUrl}
        postUrl={post.url}
        sourceName={post.sourceName}
        alt=""
        className={featured ? 'w-full' : 'w-32 shrink-0 self-start sm:w-full'}
      />
      <div
        className={`flex min-w-0 flex-1 flex-col ${featured ? 'gap-3 p-4 sm:p-5 lg:p-6' : 'gap-1.5 p-3 sm:gap-2 sm:p-4'}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-2 font-mono text-xs">
          <span className="truncate rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-accent">
            {post.sourceName}
          </span>
          <time
            dateTime={post.publishedAt}
            title={formatFullTime(post.publishedAt)}
            className="shrink-0 text-muted"
          >
            {formatPostTime(post.publishedAt, now)}
          </time>
        </div>
        <h3
          className={`font-semibold text-balance text-text transition-colors group-hover:text-accent ${
            featured
              ? 'line-clamp-3 text-xl leading-snug sm:text-2xl lg:text-3xl'
              : 'line-clamp-2 text-[15px] leading-snug sm:line-clamp-3 sm:text-base'
          }`}
        >
          {post.title}
        </h3>
        {post.author && (
          <p className="mt-auto truncate text-xs text-muted sm:text-sm">{post.author}</p>
        )}
      </div>
    </a>
  );
}
