'use client';

import { useState } from 'react';
import SourceThumbnail from '@/components/SourceThumbnail';

const MEDIA_CLASS =
  'h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]';

export default function Thumbnail({
  src,
  postUrl,
  sourceName,
  alt,
  className = '',
}: {
  src?: string;
  postUrl: string;
  sourceName: string;
  alt: string;
  className?: string;
}) {
  // Track the URL that failed so a new src gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string>();
  const usable = src !== undefined && src !== failedSrc;

  return (
    <div className={`relative aspect-video overflow-hidden bg-border ${className}`}>
      {usable ? (
        /* eslint-disable-next-line @next/next/no-img-element -- static export, remote feed images */
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className={MEDIA_CLASS}
        />
      ) : (
        <SourceThumbnail sourceName={sourceName} postUrl={postUrl} className={MEDIA_CLASS} />
      )}
    </div>
  );
}
