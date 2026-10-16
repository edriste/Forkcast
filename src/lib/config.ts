import { Platform } from 'react-native';
import { resolvePublicConfig, type PublicEnvironment } from './publicConfig';
declare global {
  var __FORKCAST_CONFIG__: PublicEnvironment | undefined;
}
// Explicit property access is required for Expo's native build-time substitutions.
const build = {
  EXPO_PUBLIC_WEB_PUSH_KEY: process.env.EXPO_PUBLIC_WEB_PUSH_KEY,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_GOOGLE_AUTH_ENABLED: process.env.EXPO_PUBLIC_GOOGLE_AUTH_ENABLED,
  EXPO_PUBLIC_OSM_MAP_STYLE_URL: process.env.EXPO_PUBLIC_OSM_MAP_STYLE_URL,
  EXPO_PUBLIC_OSM_DARK_MAP_STYLE_URL: process.env.EXPO_PUBLIC_OSM_DARK_MAP_STYLE_URL,
  EXPO_PUBLIC_TERMS_URL: process.env.EXPO_PUBLIC_TERMS_URL,
  EXPO_PUBLIC_PRIVACY_URL: process.env.EXPO_PUBLIC_PRIVACY_URL,
};
// A deployed web image can be configured at startup; native builds retain Expo configuration.
export const publicConfig = resolvePublicConfig(
  Platform.OS === 'web' && globalThis.__FORKCAST_CONFIG__ ? globalThis.__FORKCAST_CONFIG__ : build,
);
