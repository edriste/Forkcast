import { useLocale } from '../providers/Locale';
import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { Button, Card, Field, Notice, Page, useAction, useTheme } from '../components/ui';
import { signInWithGoogle } from '../lib/googleAuth';
import { useInvites, persistInvite } from '../providers/Invites';

export function AuthScreen() {
  const { t } = useLocale();

  const { styles } = useTheme();

  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [verify, setVerify] = useState(false);
  const [otp, setOtp] = useState('');
  const [info, setInfo] = useState('');
  const action = useAction();
  const { pendingInvite } = useInvites();
  async function submit() {
    await action.run(async () => {
      const address = email.trim();
      if (!/^\S+@\S+\.\S+$/.test(address)) throw new Error('Enter a valid email address.');
      if (verify) {
        const { error } = await supabase.auth.verifyOtp({
          email: address,
          token: otp.trim(),
          type: 'signup',
        });
        if (error) throw error;
        return;
      }
      if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
      if (signup && !name.trim())
        throw new Error('Enter your name so colleagues can recognize you.');
      const { data, error } = signup
        ? await supabase.auth.signUp({
            email: address,
            password,
            options: { data: { display_name: name.trim() } },
          })
        : await supabase.auth.signInWithPassword({ email: address, password });
      if (error) throw error;
      if (signup && !data.session) {
        setVerify(true);
        setInfo('Check your email for a verification code.');
      }
    });
  }
  return (
    <Page>
      <View style={{ marginTop: 48, gap: 12 }}>
        <Text style={styles.badge}>{t('FORKCAST / LUNCH TOGETHER')}</Text>
        <Text style={styles.title}>
          {t('A good lunch.')}
          {'\n'}
          {t('Better company.')}
        </Text>
        <Text style={styles.subtitle}>
          {t('Discover your colleagues’ favorite spots and share what’s cooking.')}
        </Text>
      </View>
      <Card>
        {!verify && (
          <>
            <Button
              title={t('Continue with Google')}
              busy={action.busy}
              onPress={() =>
                action.run(async () => {
                  await persistInvite(pendingInvite);
                  await signInWithGoogle();
                })
              }
            />
            <Text style={styles.subtitle}>
              {t('One button to join or sign in. No password or email code needed.')}
            </Text>
            <Text style={styles.label}>{t('Or continue with email')}</Text>
          </>
        )}
        <Text style={styles.heading}>
          {verify ? t('Verify your email') : signup ? t('Join the table') : t('Welcome back')}
        </Text>
        {signup && !verify && (
          <Field
            label={t('Your name')}
            value={name}
            onChangeText={setName}
            maxLength={80}
            autoComplete="name"
          />
        )}
        <Field
          label={t('Email')}
          value={email}
          onChangeText={setEmail}
          editable={!verify}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        {verify ? (
          <Field
            label={t('Verification code')}
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
          />
        ) : (
          <Field
            label={t('Password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={signup ? 'new-password' : 'current-password'}
          />
        )}
        <Notice error={action.error} />
        {info ? <Text style={styles.subtitle}>{t(info)}</Text> : null}
        <Button
          title={verify ? t('Verify & sign in') : signup ? t('Create account') : t('Sign in')}
          onPress={submit}
          busy={action.busy}
        />
        {verify && (
          <Button
            secondary
            title={t('Resend code')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                const { error } = await supabase.auth.resend({
                  type: 'signup',
                  email: email.trim(),
                });
                if (error) throw error;
                setInfo('A new code is on its way.');
              })
            }
          />
        )}
        <Button
          secondary
          title={
            verify
              ? t('Back to sign in')
              : signup
                ? t('Already a member? Sign in')
                : t('New here? Create account')
          }
          onPress={() => {
            setSignup(!signup && !verify);
            setVerify(false);
            setInfo('');
            action.setError('');
          }}
        />
      </Card>
      <Text style={styles.subtitle}>
        {t('Private to your team. Lunch ratings from people you know.')}
      </Text>
      {[
        [t('Terms of use'), process.env.EXPO_PUBLIC_TERMS_URL],
        [t('Privacy policy'), process.env.EXPO_PUBLIC_PRIVACY_URL],
      ].map(([label, url]) =>
        url ? (
          <Button
            key={label}
            secondary
            title={label!}
            onPress={() =>
              action.run(async () => {
                await Linking.openURL(url);
              })
            }
          />
        ) : null,
      )}
    </Page>
  );
}
