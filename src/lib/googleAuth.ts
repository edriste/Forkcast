import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import { createOAuthCallbackHandler } from './oauth';

export const googleRedirectUri =
  Platform.OS === 'web'
    ? `${window.location.origin}${window.location.pathname}`
    : 'forkcast://auth';

const exchangeCallback = createOAuthCallbackHandler(googleRedirectUri, async (code) => {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw new Error('Google sign-in expired or could not be completed. Please try again.');
});

export async function completeGoogleSignIn(url: string) {
  try {
    return await exchangeCallback(url);
  } finally {
    if (Platform.OS === 'web' && url === window.location.href) {
      const clean = new URL(url);
      if (clean.searchParams.has('code') || clean.searchParams.has('error')) {
        for (const key of ['code', 'error', 'error_code', 'error_description']) {
          clean.searchParams.delete(key);
        }
        window.history.replaceState(window.history.state, '', clean.toString());
      }
    }
  }
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: googleRedirectUri,
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Google sign-in is unavailable. Please try again.');
  if (Platform.OS === 'web') {
    window.location.assign(data.url);
    return;
  }
  const result = await WebBrowser.openAuthSessionAsync(data.url, googleRedirectUri);
  if (result.type === 'success') {
    if (!(await completeGoogleSignIn(result.url))) {
      throw new Error('Google did not return a sign-in code. Please try again.');
    }
  } else {
    throw new Error('Google sign-in was cancelled. Please try again.');
  }
}
