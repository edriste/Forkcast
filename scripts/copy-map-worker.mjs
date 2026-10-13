import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('maplibre-gl/package.json'));
mkdirSync('public', { recursive: true });
copyFileSync(resolve(root, 'dist/maplibre-gl-worker.mjs'), 'public/maplibre-worker.js');
copyFileSync(resolve(root, 'LICENSE.txt'), 'public/maplibre-LICENSE.txt');
