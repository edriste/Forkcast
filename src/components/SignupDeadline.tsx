import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CookingEvent } from '../lib/types';
import {
  deadlineFields,
  displayDeadline,
  parseBerlinDeadline,
  signupClosed,
} from '../lib/signupDeadline';
import { useSignupClock } from '../lib/useSignupClock';
import { supabase } from '../lib/supabase';
import { localDate } from '../lib/format';
import { useLocale } from '../providers/Locale';
import { Button, Chip, Field, Notice, useAction, useTheme } from './ui';

export type DeadlineDraft = { enabled: boolean; date: string; time: string };

export function SignupDeadlineFields({
  value,
  onChange,
  disabled = false,
}: {
  value: DeadlineDraft;
  onChange: (value: DeadlineDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const { styles } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{t('Signup deadline (optional)')}</Text>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Chip
          label={t('No deadline')}
          selected={!value.enabled}
          disabled={disabled}
          onPress={() => onChange({ ...value, enabled: false })}
        />
        <Chip
          label={t('Set a deadline')}
          selected={value.enabled}
          disabled={disabled}
          onPress={() => onChange({ ...value, enabled: true })}
        />
      </View>
      {value.enabled && (
        <>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flexGrow: 1, flexBasis: 160 }}>
              <Field
                label={t('Signup date (YYYY-MM-DD)')}
                value={value.date}
                editable={!disabled}
                onChangeText={(date) => onChange({ ...value, date })}
                maxLength={10}
                placeholder="2026-10-13"
              />
            </View>
            <View style={{ flexGrow: 1, flexBasis: 100 }}>
              <Field
                label={t('Signup time (HH:mm)')}
                value={value.time}
                editable={!disabled}
                onChangeText={(time) => onChange({ ...value, time })}
                maxLength={5}
                placeholder="11:00"
              />
            </View>
          </View>
          <Text style={styles.subtitle}>
            {t(
              'Berlin time. After the deadline, no new signups or extra portions; reducing portions and leaving remain possible.',
            )}
          </Text>
        </>
      )}
    </View>
  );
}

export function SignupDeadlineBadge({ event }: { event: CookingEvent }) {
  const { t, locale } = useLocale();
  const { styles, colors } = useTheme();
  const now = useSignupClock([event.signup_deadline]);
  if (!event.signup_deadline) return null;
  const closed = signupClosed(event, now);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Ionicons
        name={closed ? 'lock-closed-outline' : 'time-outline'}
        size={16}
        color={colors.accent}
        accessible={false}
      />
      <Text style={[styles.subtitle, { flex: 1 }]}>
        {t(closed ? 'Signup closed · {when} (Berlin time)' : 'Signup closes {when} (Berlin time)', {
          when: displayDeadline(event.signup_deadline, locale),
        })}
      </Text>
    </View>
  );
}

export function SignupDeadlineEditor({
  event,
  organizer,
  onSaved,
}: {
  event: CookingEvent;
  organizer: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DeadlineDraft>({
    enabled: false,
    date: event.meal_date,
    time: '11:00',
  });
  const action = useAction();
  const now = useSignupClock([event.signup_deadline]);
  const closed = signupClosed(event, now);
  if (!event.signup_deadline && (!organizer || event.meal_date < localDate(new Date(now))))
    return null;
  async function save(deadline: string | null, closeNow = false) {
    const { error } = await supabase.rpc('set_cooking_signup_deadline', {
      event: event.id,
      deadline,
      close_now: closeNow,
    });
    if (error) throw error;
    setEditing(false);
    await onSaved();
  }
  return (
    <View style={{ gap: 8 }}>
      <SignupDeadlineBadge event={event} />
      {organizer &&
        event.meal_date >= localDate(new Date(now)) &&
        (editing ? (
          <>
            <SignupDeadlineFields value={draft} onChange={setDraft} disabled={action.busy} />
            <Button
              title={t('Save signup deadline')}
              busy={action.busy}
              onPress={() =>
                action.run(() =>
                  save(draft.enabled ? parseBerlinDeadline(draft.date, draft.time) : null),
                )
              }
            />
            {!closed && (
              <Button
                secondary
                title={t('Close signup now')}
                busy={action.busy}
                onPress={() => action.run(() => save(null, true))}
              />
            )}
            <Button
              secondary
              title={t('Cancel deadline edit')}
              disabled={action.busy}
              onPress={() => {
                action.setError('');
                setEditing(false);
              }}
            />
          </>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flexGrow: 1, flexBasis: 160 }}>
              <Button
                secondary
                title={t(event.signup_deadline ? 'Edit signup deadline' : 'Set signup deadline')}
                disabled={action.busy}
                onPress={() => {
                  action.setError('');
                  setDraft({
                    enabled: !!event.signup_deadline,
                    ...(event.signup_deadline
                      ? deadlineFields(event.signup_deadline)
                      : { date: event.meal_date, time: '11:00' }),
                  });
                  setEditing(true);
                }}
              />
            </View>
            {closed && (
              <View style={{ flexGrow: 1, flexBasis: 140 }}>
                <Button
                  secondary
                  title={t('Reopen signup')}
                  busy={action.busy}
                  onPress={() => action.run(() => save(null))}
                />
              </View>
            )}
          </View>
        ))}
      <Notice error={action.error} />
    </View>
  );
}
