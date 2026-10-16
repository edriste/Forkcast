import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { publicConfig } from '../../lib/config';
import {
  currentPushEndpoint,
  disableDevicePush,
  enableDevicePush,
  loadPushSettings,
  pushSupported,
} from '../../lib/push';
import type { PushPreferences } from '../../lib/pushTypes';
import { supabase } from '../../lib/supabase';
import { useLocale } from '../../providers/Locale';
import { Button, Field, Notice, useAction, useTheme } from '../ui';

export function DevicePushSettings() {
  const { t, language } = useLocale();
  const { styles, colors } = useTheme();
  const action = useAction();
  const [preferences, setPreferences] = useState<PushPreferences | null>(null);
  const [device, setDevice] = useState(false);
  const [quietStart, setQuietStart] = useState('22');
  const [quietEnd, setQuietEnd] = useState('8');
  const [dailyLimit, setDailyLimit] = useState('3');
  const refresh = async () => {
    const settings = await loadPushSettings();
    setPreferences(settings.preferences);
    setQuietStart(String(settings.preferences.quiet_start));
    setQuietEnd(String(settings.preferences.quiet_end));
    setDailyLimit(String(settings.preferences.daily_limit));
    const endpoint = await currentPushEndpoint();
    setDevice(!!endpoint && settings.endpoints.includes(endpoint));
  };
  useEffect(() => {
    if (publicConfig.webPushKey && pushSupported()) void action.run(refresh);
  }, []);
  if (!publicConfig.webPushKey)
    return (
      <Text style={styles.subtitle}>
        {t('Device notifications are not configured on this server.')}
      </Text>
    );
  if (!pushSupported())
    return (
      <Text style={styles.subtitle}>
        {t(
          'Use a supported browser with HTTPS. On iPhone, add Forkcast to your Home Screen first.',
        )}
      </Text>
    );
  return (
    <>
      <Text style={styles.subtitle}>
        {t(
          'Optional alerts, grouped to reduce interruptions. At most 3 updates per day across all organizations. Your inbox always keeps the full history.',
        )}
      </Text>
      <Text style={styles.subtitle}>
        {t('On iPhone, add Forkcast to your Home Screen before enabling alerts.')}
      </Text>
      <Notice error={action.error} />
      <Button
        secondary
        title={device ? t('Disable on this device') : t('Enable on this device')}
        busy={action.busy}
        onPress={() =>
          action.run(async () => {
            if (device) await disableDevicePush();
            else await enableDevicePush(language);
            await refresh();
          })
        }
      />
      {!preferences && action.error && (
        <Button secondary title={t('Retry')} onPress={() => action.run(refresh)} />
      )}
      {preferences && (
        <>
          <Pressable
            disabled={action.busy}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: preferences.enabled }}
            onPress={() => setPreferences({ ...preferences, enabled: !preferences.enabled })}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={styles.text}>
              {preferences.enabled ? '☑' : '☐'} {t('Device alerts enabled across your devices')}
            </Text>
          </Pressable>
          {(
            [
              ['cooking', 'New lunch plans'],
              ['deadlines', 'Signup deadlines'],
              ['arrivals', 'Food has arrived'],
              ['replies', 'Replies to cooking questions'],
              ['payments', 'Occasional unpaid reminders'],
              ['organizer', 'Organizer activity'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              disabled={action.busy}
              accessibilityRole="checkbox"
              accessibilityLabel={t(label)}
              accessibilityState={{ checked: preferences[key] }}
              onPress={() => setPreferences({ ...preferences, [key]: !preferences[key] })}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={styles.text}>
                {preferences[key] ? '☑' : '☐'} {t(label)}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.subtitle}>
            {t(
              'Unpaid reminders are off by default and sent at most once every 3 days. Food arrivals can bypass the 30-minute spacing, but never quiet hours or the daily limit.',
            )}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t('Quiet from (0–23)')}
                value={quietStart}
                onChangeText={setQuietStart}
                editable={!action.busy}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={t('Quiet until (0–23)')}
                value={quietEnd}
                onChangeText={setQuietEnd}
                editable={!action.busy}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </View>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {t('Time zone: {zone}', { zone: preferences.timezone })} ·{' '}
            {t('Matching hours disable quiet time.')}
          </Text>
          <Field
            label={t('Maximum updates per day (1–3)')}
            value={dailyLimit}
            onChangeText={setDailyLimit}
            editable={!action.busy}
            keyboardType="number-pad"
            maxLength={1}
          />
          <Button
            title={t('Save notification preferences')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                if (
                  !/^\d{1,2}$/.test(quietStart) ||
                  !/^\d{1,2}$/.test(quietEnd) ||
                  Number(quietStart) > 23 ||
                  Number(quietEnd) > 23 ||
                  !/^[1-3]$/.test(dailyLimit)
                )
                  throw new Error('Choose hours from 0 to 23 and a daily limit from 1 to 3.');
                const { error } = await supabase.rpc('set_web_push_preferences', {
                  settings: {
                    ...preferences,
                    quiet_start: Number(quietStart),
                    quiet_end: Number(quietEnd),
                    daily_limit: Number(dailyLimit),
                    locale: language,
                  },
                });
                if (error) throw error;
                await refresh();
              })
            }
          />
          <Button
            secondary
            title={t('Remove all registered devices')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                await disableDevicePush();
                const { error } = await supabase.rpc('unregister_web_push', {
                  device_endpoint: null,
                });
                if (error) throw error;
                await refresh();
              })
            }
          />
        </>
      )}
    </>
  );
}
