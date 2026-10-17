import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Always define NEXT_PUBLIC_MOCK so it is inlined (as '' when unset) and the mock branch is
  // dead-code-eliminated from normal builds; Next leaves undefined env vars un-inlined.
  env: { NEXT_PUBLIC_MOCK: process.env.NEXT_PUBLIC_MOCK ?? '' },
};

export default config;
