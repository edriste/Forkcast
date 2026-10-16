import { afterEach, expect, test, vi } from 'vitest';
import { parseRelease, watchWebUpdates } from '../src/lib/webUpdates';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareWeb } from '../scripts/prepare-web.mjs';

const current = 'a'.repeat(64),
  next = 'b'.repeat(64);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('web releases require a valid version rather than a fallback HTML document', () => {
  expect(parseRelease({ version: next })).toBe(next);
  for (const value of [null, '<html>Not found</html>', {}, { version: '../' }, { version: 42 }])
    expect(parseRelease(value)).toBeNull();
});

test('update checks are bounded, foreground-aware, recover offline and clean up', async () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const navigator = { onLine: true };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('navigator', navigator);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: current }) });
  vi.stubGlobal('fetch', fetch);
  const report = vi.fn();
  const stop = watchWebUpdates(current, report);
  await vi.advanceTimersByTimeAsync(0);
  expect(report).toHaveBeenLastCalledWith(null);
  expect(fetch).toHaveBeenCalledWith(
    '/version.json',
    expect.objectContaining({ cache: 'no-store', redirect: 'error' }),
  );
  window.dispatchEvent(new Event('focus'));
  expect(fetch).toHaveBeenCalledTimes(1);
  document.visibilityState = 'hidden';
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue({ ok: true, json: async () => ({ version: next }) });
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(report).toHaveBeenLastCalledWith(next);
  navigator.onLine = false;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  navigator.onLine = true;
  fetch.mockRejectedValueOnce(new Error('Offline'));
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(0);
  expect(report).toHaveBeenCalledTimes(2);
  // A rolled-back deployment removes a previously advertised update.
  fetch.mockResolvedValue({ ok: true, json: async () => ({ version: current }) });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(report).toHaveBeenLastCalledWith(null);
  const calls = fetch.mock.calls.length;
  stop();
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(600_000);
  expect(fetch).toHaveBeenCalledTimes(calls);
});

test('prepared web exports have matching release markers, standard icons and repeatable preparation', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'forkcast-web-release-'));
  try {
    await writeFile(
      resolve(directory, 'index.html'),
      '<html><head></head><body><script src="/bundle-one.js"></script></body></html>',
    );
    const prepare = () => prepareWeb(directory);
    prepare();
    const first = JSON.parse(await readFile(resolve(directory, 'version.json'), 'utf8')).version;
    expect(parseRelease({ version: first })).toBe(first);
    const html = await readFile(resolve(directory, 'index.html'), 'utf8');
    expect(html).toContain(`globalThis.__FORKCAST_BUILD__="${first}"`);
    expect(html.indexOf('__FORKCAST_BUILD__')).toBeLessThan(html.indexOf('/bundle-one.js'));
    for (const size of [192, 512]) {
      const png = await readFile(resolve(directory, `icon-${size}.png`));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
      expect(png.equals(await readFile(`assets/app-icon-${size}.png`))).toBe(true);
    }
    const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
      '192x192',
      '512x512',
    ]);
    prepare();
    expect(JSON.parse(await readFile(resolve(directory, 'version.json'), 'utf8')).version).toBe(
      first,
    );
    await writeFile(
      resolve(directory, 'index.html'),
      html.replace('/bundle-one.js', '/bundle-two.js'),
    );
    prepare();
    expect(JSON.parse(await readFile(resolve(directory, 'version.json'), 'utf8')).version).not.toBe(
      first,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
