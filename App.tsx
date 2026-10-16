import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppNavigation } from './src/AppNavigation';
import { AppUpdateNotice } from './src/components/app/AppUpdateNotice';
import { PushActivity } from './src/components/notifications/PushActivity';
import { AuthProvider, useSession } from './src/providers/Auth';
import { CreditsProvider } from './src/providers/Credits';
import { InviteProvider } from './src/providers/Invites';
import { LocaleProvider } from './src/providers/Locale';
import { OrganizationProvider } from './src/providers/Organizations';
import { ThemeProvider, useTheme } from './src/providers/Theme';
import { AuthScreen } from './src/screens/AuthScreen';
function SignedIn() {
  const session = useSession();
  return (
    <OrganizationProvider key={session.user.id}>
      <PushActivity />
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
        <AppUpdateNotice />
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
