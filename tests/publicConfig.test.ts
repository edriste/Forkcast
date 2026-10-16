import { expect, test } from 'vitest';
import { resolvePublicConfig, validBackend } from '../src/lib/publicConfig';
test('self-hosted hosts, anon and publishable keys are supported and server keys rejected', () => {
  const values = {
    EXPO_PUBLIC_SUPABASE_URL: 'https://api.lunch.example.test/',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: 'false',
  };
  const config = resolvePublicConfig(values);
  expect(config.supabaseUrl).toBe('https://api.lunch.example.test');
  expect(config.googleAuthEnabled).toBe(false);
  expect(validBackend(config)).toBe(true);
  for (const role of ['anon', 'service_role', 'authenticated']) {
    const key = `a.${btoa(JSON.stringify({ role }))}.b`;
    expect(validBackend({ ...config, supabaseKey: key })).toBe(role === 'anon');
  }
  expect(validBackend({ ...config, supabaseKey: 'sb_secret_test' })).toBe(false);
  expect(validBackend({ ...config, supabaseUrl: 'https://user:password@api.example.test' })).toBe(
    false,
  );
});

test('push links accept only one valid target and a valid organization identifier', async () => {
  const { parsePushLink } = await import('../src/lib/pushLink');
  const org = '10000000-0000-0000-0000-000000000001',
    event = '20000000-0000-0000-0000-000000000001';
  expect(parsePushLink(`?pushOrg=${org}&pushEvent=${event}`)).toEqual({ org, event });
  expect(parsePushLink(`?pushOrg=${org}&pushEvent=${event}&pushOrder=${event}`)).toBeNull();
  expect(parsePushLink(`?pushOrg=${org}&pushEvent=https://evil.test`)).toBeNull();
});
