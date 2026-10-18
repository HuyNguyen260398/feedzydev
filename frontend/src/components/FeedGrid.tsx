import PostCard from '@/components/PostCard';
import type { DayGroup } from '@/lib/time';

export default function FeedGrid({ groups, now }: { groups: DayGroup[]; now: Date }) {
  return (
    <div className="space-y-6 sm:space-y-8">
      {groups.map((group, gi) => (
        <section key={group.key} aria-labelledby={`day-${group.key}`}>
          <h2
            id={`day-${group.key}`}
            className="sticky top-14 z-10 -mx-3 mb-3 flex items-center gap-2 bg-bg/85 px-3 py-2 font-mono text-xs font-medium tracking-[0.14em] text-muted uppercase backdrop-blur sm:-mx-4 sm:px-4"
          >
            <span className="text-accent" aria-hidden="true">
              {'//'}
            </span>
            {group.label}
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span className="tracking-normal normal-case">
              {group.posts.length} {group.posts.length === 1 ? 'post' : 'posts'}
            </span>
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {group.posts.map((post, i) => {
              const featured = gi === 0 && i === 0;
              return (
                <li key={post.postId} className={featured ? 'sm:col-span-2 lg:row-span-2' : ''}>
                  <PostCard post={post} variant={featured ? 'featured' : 'tile'} now={now} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
