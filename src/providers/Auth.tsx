import { useLocale } from '../providers/Locale';
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, message, supabase } from '../lib/supabase';
import { Button, Loading, Notice, Page, useTheme } from '../components/ui';
import { Text } from 'react-native';
import * as Linking from 'expo-linking';
import { completeGoogleSignIn } from '../lib/googleAuth';

const AuthContext = createContext<Session | null>(null);
export function useSession() {
  return useContext(AuthContext)!;
}
export function AuthProvider({
  children,
  signedOut,
}: React.PropsWithChildren<{ signedOut: React.ReactNode }>) {
  const { t } = useLocale();

  const { styles } = useTheme();

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let active = true;
    const receive = async (url: string) => {
      try {
        await completeGoogleSignIn(url);
      } catch (e) {
        if (active) setError(message(e));
      }
    };
    const links = Linking.addEventListener('url', ({ url }) => void receive(url));
    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        setSession(data.session);
        const url = await Linking.getInitialURL();
        if (url) await receive(url);
        if (active) setLoading(false);
      })
      .catch((e) => {
        if (active) {
          setError(message(e));
          setLoading(false);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) {
        setSession(next);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      links.remove();
      data.subscription.unsubscribe();
    };
  }, []);
  if (!configured)
    return (
      <Page>
        <Text style={styles.title}>{t('Welcome to Forkcast')}</Text>
        <Text style={styles.subtitle}>{t('Good lunch starts with good company.')}</Text>
        <Text style={styles.text}>
          {t(
            'Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env, apply the migrations, then restart Expo. See README.md for setup.',
          )}
        </Text>
      </Page>
    );
  if (loading) return <Loading />;
  if (error)
    return (
      <Page>
        <Notice error={error} />
        <Button
          title={t('Try again')}
          onPress={() => {
            setError('');
            setLoading(true);
            supabase.auth
              .getSession()
              .then(({ data, error }) => {
                setSession(data.session);
                setError(error?.message ?? '');
                setLoading(false);
              })
              .catch((e) => {
                setError(message(e));
                setLoading(false);
              });
          }}
        />
      </Page>
    );
  return (
    <AuthContext.Provider value={session}>{session ? children : signedOut}</AuthContext.Provider>
  );
}
