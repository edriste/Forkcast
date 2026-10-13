import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Forkcast',
  slug: 'forkcast',
  scheme: 'forkcast',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  web: { favicon: './assets/icon.png', themeColor: '#FF8A24' },
  locales: {
    en: {
      ios: {
        NSPhotoLibraryUsageDescription:
          'Allow Forkcast to upload meal photos and grocery receipts.',
      },
    },
    de: {
      ios: {
        NSPhotoLibraryUsageDescription:
          'Erlaube Forkcast, Essensfotos und Einkaufsbelege hochzuladen.',
      },
    },
  },
  ios: { supportsTablet: true, bundleIdentifier: 'com.forkcast.app' },
  android: { package: 'com.forkcast.app' },
  plugins: [
    [
      'expo-localization',
      {
        supportedLocales: { ios: ['en', 'de'], android: ['en', 'de'] },
        allowDynamicLocaleChangesAndroid: true,
      },
    ],
    '@maplibre/maplibre-react-native',
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Forkcast to upload meal photos and grocery receipts.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
};
export default config;
