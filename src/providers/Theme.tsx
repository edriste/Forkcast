import React, { createContext, useContext, useEffect } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
const lightColors = {
  ink: '#20242B',
  muted: '#626B78',
  orange: '#FF8A24',
  accent: '#BD4800',
  field: '#F4F6F8',
  light: '#FFF1E5',
  cream: '#F7F8FA',
  white: '#FFFFFF',
  line: '#E5E9EF',
  red: '#B42318',
  gold: '#E9A321',
  surface: '#FFFFFF',
  onOrange: '#23262B',
  office: '#20242B',
  onOffice: '#FFFFFF',
  markerBorder: '#FFFFFF',
};

type Palette = typeof lightColors;
const darkColors: Palette = {
  ink: '#F2F4F7',
  muted: '#ADB5C2',
  orange: '#FFA347',
  accent: '#FFB06B',
  field: '#252B34',
  light: '#30271F',
  cream: '#111419',
  white: '#FFFFFF',
  line: '#303640',
  red: '#FF9D94',
  gold: '#FFD06F',
  surface: '#1C2027',
  onOrange: '#23262B',
  office: '#303844',
  onOffice: '#F2F4F7',
  markerBorder: '#4A5260',
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.cream },
    content: {
      padding: 22,
      gap: 16,
      paddingBottom: 40,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
    },
    title: { fontSize: 30, fontWeight: '700', color: colors.ink, letterSpacing: -1 },
    subtitle: { fontSize: 16, color: colors.muted, lineHeight: 23 },
    label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 7 },
    card: {
      padding: 18,
      backgroundColor: colors.surface,
      borderRadius: 24,
      boxShadow: '0 4px 18px rgba(20, 28, 38, 0.04)',
      borderWidth: 1,
      borderColor: colors.line,
      gap: 12,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    heading: { fontSize: 19, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 },
    text: { color: colors.ink, fontSize: 15, lineHeight: 22 },
    input: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 16,
      color: colors.ink,
      backgroundColor: colors.field,
    },
    button: {
      backgroundColor: colors.orange,
      paddingHorizontal: 18,
      paddingVertical: 13,
      borderRadius: 16,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
    },
    error: { color: colors.red, fontSize: 14, lineHeight: 21 },
    badge: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  });

const lightTheme = { dark: false, colors: lightColors, styles: createStyles(lightColors) };
const darkTheme = { dark: true, colors: darkColors, styles: createStyles(darkColors) };
const Context = createContext(lightTheme);
export function useTheme() {
  return useContext(Context);
}
export function ThemeProvider({ children }: React.PropsWithChildren) {
  const dark = useColorScheme() === 'dark';
  const theme = dark ? darkTheme : lightTheme;
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.body.style.backgroundColor = theme.colors.cream;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme.colors.cream);
    } else {
      void SystemUI.setBackgroundColorAsync(theme.colors.cream).catch(() => {});
    }
  }, [dark, theme]);
  return <Context.Provider value={theme}>{children}</Context.Provider>;
}
