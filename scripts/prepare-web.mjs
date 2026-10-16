import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function prepareWeb(directory = 'dist') {
  const output = resolve(directory);
  const index = resolve(output, 'index.html');
  const html = readFileSync(index, 'utf8');
  // Tie the running page to its own release, never to the first network check (which
  // might already return a newer deployment). Re-running preparation is idempotent.
  const clean = html.replace(/<!--forkcast-release-->[\s\S]*?<!--\/forkcast-release-->/g, '');
  const hash = createHash('sha256').update(clean);
  for (const file of [
    'public/manifest.webmanifest',
    'public/service-worker.js',
    'assets/app-icon-192.png',
    'assets/app-icon-512.png',
  ])
    hash.update(readFileSync(file));
  const version = hash.digest('hex');
  const hook = `<!--forkcast-release--><script>globalThis.__FORKCAST_BUILD__=${JSON.stringify(version)};</script><script src="/runtime-config.js"></script><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-192.png"><!--/forkcast-release-->`;
  writeFileSync(index, clean.replace('<head>', `<head>${hook}`));
  writeFileSync(resolve(output, 'version.json'), JSON.stringify({ version }));
  // Standard static hosting still works with build-time values; Docker replaces this on startup.
  writeFileSync(
    resolve(output, 'runtime-config.js'),
    '// Forkcast runtime configuration is supplied by the container.\n',
  );

  mkdirSync(resolve(output, 'auth'), { recursive: true });
  copyFileSync('supabase/templates/confirmation.html', resolve(output, 'auth/confirmation.html'));

  copyFileSync('assets/app-icon-192.png', resolve(output, 'icon-192.png'));
  copyFileSync('assets/app-icon-512.png', resolve(output, 'icon-512.png'));
  copyFileSync('assets/app-icon-192.png', resolve(output, 'push-icon.png'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareWeb(process.argv[2]);
}
