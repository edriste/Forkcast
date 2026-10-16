import { writeFileSync } from 'node:fs';
const allowed = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'GOOGLE_AUTH_ENABLED',
  'OSM_MAP_STYLE_URL',
  'OSM_DARK_MAP_STYLE_URL',
  'TERMS_URL',
  'PRIVACY_URL',
  'WEB_PUSH_KEY',
];
export function runtimeConfiguration(env) {
  const config = Object.fromEntries(
    allowed.map((key) => [`EXPO_PUBLIC_${key}`, env[`EXPO_PUBLIC_${key}`] ?? '']),
  );
  config.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED ||= 'false';
  const url = new URL(config.EXPO_PUBLIC_SUPABASE_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Set a browser-reachable HTTP(S) EXPO_PUBLIC_SUPABASE_URL.');
  const key = config.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key || key.includes('YOUR_') || key.startsWith('sb_secret_'))
    throw new Error('Set a public publishable/anon key, never a server secret.');
  if (key.split('.').length === 3) {
    let role;
    try {
      role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
    } catch {
      /* invalid */
    }
    if (role !== 'anon') throw new Error('The browser JWT API key must have the anon role.');
  }
  return `globalThis.__FORKCAST_CONFIG__ = ${JSON.stringify(config).replace(/</g, '\\u003c')};\n`;
}
if (process.argv[1]?.endsWith('/write-runtime-config.mjs')) {
  try {
    writeFileSync(
      process.argv[2] || '/usr/share/nginx/html/runtime-config.js',
      runtimeConfiguration(process.env),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
