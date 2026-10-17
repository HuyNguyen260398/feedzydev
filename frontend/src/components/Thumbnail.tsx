'use client';

import { useState } from 'react';
import { initialOf, placeholderStyle } from '@/lib/placeholder';

export default function Thumbnail({
  src,
  sourceName,
  iconUrl,
  alt,
  className = '',
}: {
  src?: string;
  sourceName: string;
  iconUrl?: string;
  alt: string;
  className?: string;
}) {
  // Track the URL that failed so a new src gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string>();
  const [failedIcon, setFailedIcon] = useState<string>();
  const showImage = src !== undefined && src !== failedSrc;
  const showIcon = iconUrl !== undefined && iconUrl !== failedIcon;

  return (
    <div className={`relative aspect-video overflow-hidden bg-border ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- static export, remote feed images
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
      ) : (
        <div
          className="fz-placeholder flex h-full w-full items-center justify-center"
          style={placeholderStyle(sourceName)}
        >
          {showIcon ? (
            // eslint-disable-next-line @next/next/no-img-element -- static export, remote favicon
            <img
              src={iconUrl}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setFailedIcon(iconUrl)}
              className="relative h-1/3 max-h-16 w-auto rounded-lg bg-white/90 p-1.5 shadow-lg"
            />
          ) : (
            <span
              aria-hidden="true"
              className="relative font-mono text-4xl font-bold text-white/90 drop-shadow"
            >
              {initialOf(sourceName)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
