'use client';

import { useState } from 'react';

export const DEFAULT_THUMBNAIL = '/default-thumbnail.svg';

export default function Thumbnail({
  src,
  alt,
  className = '',
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  // Track the URL that failed so a new src gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string>();
  const usable = src !== undefined && src !== failedSrc;

  return (
    <div className={`relative aspect-video overflow-hidden bg-border ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, remote feed images */}
      <img
        src={usable ? src : DEFAULT_THUMBNAIL}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={usable ? () => setFailedSrc(src) : undefined}
        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
      />
    </div>
  );
}
