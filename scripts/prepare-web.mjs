import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const assets = {
  'manifest.webmanifest': 'public/manifest.webmanifest',
  'service-worker.js': 'public/service-worker.js',
  'icon-192.png': 'assets/app-icon-192.png',
  'icon-512.png': 'assets/app-icon-512.png',
  'push-icon.png': 'assets/app-icon-192.png',
  'auth/confirmation.html': 'supabase/templates/confirmation.html',
  _headers: 'public/_headers',
  'LICENSE.txt': 'LICENSE',
  'THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
};

export function prepareWeb(directory = resolve(projectDirectory, 'dist')) {
  const output = resolve(directory);
  const index = resolve(output, 'index.html');
  const html = readFileSync(index, 'utf8').replace(
    /<!--forkcast-release-->[\s\S]*?<!--\/forkcast-release-->/g,
    '',
  );
  if (!/<head(?:\s[^>]*)?>/i.test(html))
    throw new Error('The web export index.html must contain a <head> element.');

  // Hash the clean page and PWA assets so repeated preparation keeps the same release ID.
  const hash = createHash('sha256').update(html);
  for (const name of ['manifest.webmanifest', 'service-worker.js', 'icon-192.png', 'icon-512.png'])
    hash.update(readFileSync(resolve(projectDirectory, assets[name])));
  const version = hash.digest('hex');
  const hook = [
    '<!--forkcast-release-->',
    `<script>globalThis.__FORKCAST_BUILD__=${JSON.stringify(version)};</script>`,
    '<script src="/runtime-config.js"></script>',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<link rel="apple-touch-icon" href="/icon-192.png">',
    '<!--/forkcast-release-->',
  ].join('');

  for (const [destination, source] of Object.entries(assets)) {
    const target = resolve(output, destination);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(projectDirectory, source), target);
  }
  writeFileSync(
    index,
    html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + hook),
  );
  writeFileSync(resolve(output, 'version.json'), JSON.stringify({ version }));
  // Docker replaces this at startup; other hosts use the app's build-time settings.
  writeFileSync(
    resolve(output, 'runtime-config.js'),
    '// Forkcast runtime configuration is supplied by the container.\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareWeb(process.argv[2]);
}
