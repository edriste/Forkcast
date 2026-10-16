export type PublicConfig = {
  supabaseUrl: string;
  supabaseKey: string;
  googleAuthEnabled: boolean;
  mapStyleUrl: string;
  darkMapStyleUrl: string;
  termsUrl: string;
  privacyUrl: string;
  webPushKey: string;
};
export type PublicEnvironment = Record<string, string | undefined>;
export function isPublicKey(key: string): boolean {
  if (!key || key.includes('YOUR_') || key.startsWith('sb_secret_')) return false;
  if (key.split('.').length === 3) {
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(payload)).role === 'anon';
    } catch {
      return false;
    }
  }
  return true;
}
export function resolvePublicConfig(env: PublicEnvironment): PublicConfig {
  return {
    supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '') ?? '',
    supabaseKey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    googleAuthEnabled: env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED !== 'false',
    mapStyleUrl:
      env.EXPO_PUBLIC_OSM_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
    darkMapStyleUrl:
      env.EXPO_PUBLIC_OSM_DARK_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark',
    termsUrl: env.EXPO_PUBLIC_TERMS_URL ?? '',
    privacyUrl: env.EXPO_PUBLIC_PRIVACY_URL ?? '',
    webPushKey: env.EXPO_PUBLIC_WEB_PUSH_KEY ?? '',
  };
}
export function validBackend(config: PublicConfig) {
  try {
    const url = new URL(config.supabaseUrl);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !config.supabaseUrl.includes('YOUR_') &&
      isPublicKey(config.supabaseKey)
    );
  } catch {
    return false;
  }
}
