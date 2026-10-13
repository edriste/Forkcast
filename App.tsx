import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useSession } from './src/providers/Auth';
import { AuthScreen } from './src/screens/AuthScreen';
import { OrganizationProvider } from './src/providers/Organizations';
import { AppNavigation } from './src/AppNavigation';
import { InviteProvider } from './src/providers/Invites';
import { ThemeProvider, useTheme } from './src/providers/Theme';
import { CreditsProvider } from './src/providers/Credits';
import { LocaleProvider } from './src/providers/Locale';
function SignedIn() {
  const session = useSession();
  return (
    <OrganizationProvider key={session.user.id}>
      <AppNavigation />
    </OrganizationProvider>
  );
}
function AppContent() {
  const { colors, dark } = useTheme();
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.cream }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <StatusBar style={dark ? 'light' : 'dark'} />
        <CreditsProvider>
          <InviteProvider>
            <AuthProvider signedOut={<AuthScreen />}>
              <SignedIn />
            </AuthProvider>
          </InviteProvider>
        </CreditsProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
export default function App() {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </LocaleProvider>
  );
}
