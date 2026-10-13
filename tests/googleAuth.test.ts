import { expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  oauth: vi.fn(),
  exchange: vi.fn(),
  browser: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: mocks.browser }));
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: mocks.oauth,
      exchangeCodeForSession: mocks.exchange,
    },
  },
}));
import { signInWithGoogle } from '../src/lib/googleAuth';

test('native Google login opens the system browser and exchanges its callback', async () => {
  mocks.oauth.mockResolvedValue({ data: { url: 'https://provider.test/authorize' }, error: null });
  mocks.browser.mockResolvedValue({ type: 'success', url: 'forkcast://auth?code=native' });
  mocks.exchange.mockResolvedValue({ error: null });
  await signInWithGoogle();
  expect(mocks.oauth).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: 'google',
      options: expect.objectContaining({
        redirectTo: 'forkcast://auth',
        skipBrowserRedirect: true,
      }),
    }),
  );
  expect(mocks.browser).toHaveBeenCalledWith('https://provider.test/authorize', 'forkcast://auth');
  expect(mocks.exchange).toHaveBeenCalledWith('native');
});

test('native browser dismissal does not establish a session', async () => {
  mocks.exchange.mockClear();
  mocks.browser.mockResolvedValue({ type: 'cancel' });
  await expect(signInWithGoogle()).rejects.toThrow('cancelled');
  expect(mocks.exchange).not.toHaveBeenCalled();
});
