import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve(process.argv[2] || 'dist');
const index = resolve(output, 'index.html');
const hook =
  '<script src="/runtime-config.js"></script><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/push-icon.png">';
const html = readFileSync(index, 'utf8');
if (!html.includes(hook)) writeFileSync(index, html.replace('<head>', `<head>${hook}`));
// Standard static hosting still works with build-time values; Docker replaces this on startup.
writeFileSync(
  resolve(output, 'runtime-config.js'),
  '// Forkcast runtime configuration is supplied by the container.\n',
);

mkdirSync(resolve(output, 'auth'), { recursive: true });
copyFileSync('supabase/templates/confirmation.html', resolve(output, 'auth/confirmation.html'));

copyFileSync('assets/icon.png', resolve(output, 'push-icon.png'));
