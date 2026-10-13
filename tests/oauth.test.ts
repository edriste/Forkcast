import { expect, test, vi } from 'vitest';
import { createOAuthCallbackHandler } from '../src/lib/oauth';

test('only the configured callback can exchange an OAuth code', async () => {
  const exchange = vi.fn(async () => {});
  const handle = createOAuthCallbackHandler('forkcast://auth', exchange);
  for (const url of [
    'forkcast://join?code=invite',
    'https://auth?code=x',
    'forkcast://auth/other?code=x',
    'invalid',
    'forkcast://auth',
  ]) {
    expect(await handle(url)).toBe(false);
  }
  expect(exchange).not.toHaveBeenCalled();
  expect(await handle('forkcast://auth?code=oauth-code')).toBe(true);
  expect(exchange).toHaveBeenCalledWith('oauth-code');
});

test('duplicate native browser and linking callbacks exchange only once', async () => {
  const exchange = vi.fn(async () => {});
  const handle = createOAuthCallbackHandler('forkcast://auth', exchange);
  await Promise.all([handle('forkcast://auth?code=one'), handle('forkcast://auth?code=one')]);
  expect(exchange).toHaveBeenCalledTimes(1);
});

test('callback cancellation and rejected exchanges are retryable errors', async () => {
  const exchange = vi.fn(async (code: string) => {
    if (code === 'expired') throw new Error('Expired code');
  });
  const handle = createOAuthCallbackHandler('https://app.test/', exchange);
  await expect(
    handle('https://app.test/?error=access_denied&error_description=private'),
  ).rejects.toThrow('cancelled');
  expect(exchange).not.toHaveBeenCalled();
  await expect(handle('https://app.test/?code=expired')).rejects.toThrow('Expired code');
  expect(await handle('https://app.test/?code=fresh')).toBe(true);
});
