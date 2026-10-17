import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores(['.next/', 'out/', 'node_modules/', 'coverage/', 'next-env.d.ts']),
  ...nextVitals,
  ...nextTs,
]);
