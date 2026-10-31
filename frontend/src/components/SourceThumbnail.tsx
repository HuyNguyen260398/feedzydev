'use client';

import { useId } from 'react';
import { WINDOW_FILL, sourceTheme } from '@/lib/sourceTheme';

// Space the title may fill inside the template's terminal window, in viewBox units.
const TITLE_WIDTH = 640;
const CHAR_EM = 0.6; // monospace advance width
const MAX_FONT_SIZE = 84;
const MAX_WORD_LENGTH = 26;
const PROMPT_AND_CURSOR_LENGTH = 3;

export function titleFontSize(word: string): number {
  const chars = Math.min(word.length, MAX_WORD_LENGTH) + PROMPT_AND_CURSOR_LENGTH;
  return Math.min(MAX_FONT_SIZE, Math.floor(TITLE_WIDTH / (CHAR_EM * chars)));
}

/** Blends a #rrggbb colour into another; weight is the share of the first. */
function mix(a: string, b: string, weight: number): string {
  const channel = (i: number) =>
    Math.round(
      parseInt(a.slice(i, i + 2), 16) * weight + parseInt(b.slice(i, i + 2), 16) * (1 - weight),
    )
      .toString(16)
      .padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export default function SourceThumbnail({
  sourceName,
  postUrl,
  className = '',
}: {
  sourceName: string;
  postUrl: string;
  className?: string;
}) {
  // Each inline svg needs its own ids; strip what React adds that url(#...) may not accept.
  const id = useId().replace(/\W/g, '');
  const { label, accent } = sourceTheme(sourceName, postUrl);
  const word = label.length > MAX_WORD_LENGTH ? `${label.slice(0, MAX_WORD_LENGTH - 1)}…` : label;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1280 720"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={mix(accent, '#000000', 0.18)} />
          <stop offset="1" stopColor="#000000" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={accent} stopOpacity="0.32" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}grid`} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="2" />
        </pattern>
      </defs>

      <rect width="1280" height="720" fill={`url(#${id}bg)`} />
      <rect width="1280" height="720" fill={`url(#${id}grid)`} />
      <ellipse cx="640" cy="360" rx="560" ry="300" fill={`url(#${id}glow)`} />

      {/* feed arcs, bottom-left and top-right */}
      <g fill="none" stroke={accent} strokeLinecap="round" strokeOpacity="0.18" strokeWidth="18">
        <path d="M0 520a200 200 0 0 1 200 200" />
        <path d="M0 400a320 320 0 0 1 320 320" />
        <path d="M1280 200a200 200 0 0 1-200-200" />
        <path d="M1280 320a320 320 0 0 1-320-320" />
      </g>
      <circle cx="0" cy="720" r="60" fill={accent} fillOpacity="0.18" />
      <circle cx="1280" cy="0" r="60" fill={accent} fillOpacity="0.18" />

      {/* terminal window */}
      <g transform="translate(290 210)">
        <rect
          width="700"
          height="300"
          rx="22"
          fill={WINDOW_FILL}
          stroke={accent}
          strokeOpacity="0.45"
          strokeWidth="3"
        />
        <path d="M0 22a22 22 0 0 1 22-22h656a22 22 0 0 1 22 22v34H0z" fill="#262626" />
        <circle cx="36" cy="28" r="9" fill="#f87171" />
        <circle cx="66" cy="28" r="9" fill="#fbbf24" />
        <circle cx="96" cy="28" r="9" fill="#34d399" />
        <g className="font-mono" fontWeight="700">
          <text x="350" y="185" textAnchor="middle" fontSize={titleFontSize(label)} fill="#e5e5e5">
            {'> '}
            <tspan fill={accent}>{word}</tspan>_
          </text>
          <text
            x="350"
            y="245"
            textAnchor="middle"
            fontSize="26"
            fontWeight="500"
            fill="#a3a3a3"
            letterSpacing="3"
          >
            devops · cloud · sre
          </text>
        </g>
      </g>
    </svg>
  );
}
