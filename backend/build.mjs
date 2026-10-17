import { build } from 'esbuild';
import { existsSync } from 'node:fs';

const entries = {
  'src/api/handler.ts': 'dist/api/index.js',
  'src/crawler/handler.ts': 'dist/crawler/index.js',
  'src/presignup/handler.ts': 'dist/presignup/index.js',
};

for (const [entry, outfile] of Object.entries(entries)) {
  if (!existsSync(entry)) continue;
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
  });
}
