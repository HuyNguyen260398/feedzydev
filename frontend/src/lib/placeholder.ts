function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic two-stop gradient derived from a string hash. */
export function placeholderStyle(seed: string): { background: string } {
  const hue = hash(seed) % 360;
  const second = (hue + 40) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 60% 40%), hsl(${second} 65% 28%))`,
  };
}

/** Uppercase first alphanumeric character, or '?' if none. */
export function initialOf(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toUpperCase() : '?';
}
