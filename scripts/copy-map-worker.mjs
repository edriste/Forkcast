import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const maplibre = dirname(require.resolve('maplibre-gl/package.json'));
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));

mkdirSync(publicDirectory, { recursive: true });
for (const [source, destination] of [
  ['dist/maplibre-gl-worker.mjs', 'maplibre-worker.js'],
  ['LICENSE.txt', 'maplibre-LICENSE.txt'],
]) {
  copyFileSync(resolve(maplibre, source), resolve(publicDirectory, destination));
}
