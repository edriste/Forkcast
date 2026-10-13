import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CookingEvent, Participant } from '../lib/types';
import { useLocale } from '../providers/Locale';
import { Card, Empty, Notice, useAction, useTheme } from './ui';
import { supabase } from '../lib/supabase';
import { useNotifications } from '../providers/Notifications';
import { InfoDisclosure } from './compact';
export function CookingParticipants({
  event,
  participants,
  userId,
  refresh,
}: {
  event: CookingEvent;
  participants: Participant[];
  userId: string;
  refresh: () => Promise<void>;
}) {
  const { t, money } = useLocale();
  const { styles, colors } = useTheme();
  const organizer = event.organizer_id === userId;
  const action = useAction();
  const notifications = useNotifications();
  const sorted = [...participants].sort((a, b) =>
    (a.profiles?.display_name ?? '').localeCompare(b.profiles?.display_name ?? ''),
  );
  const paid = sorted.filter((p) => p.paid);
  const unpaid = sorted.filter((p) => !p.paid);
  const amount = (items: Participant[]) =>
    items.reduce((sum, p) => sum + p.portions * event.price_cents, 0);
  const row = (p: Participant) => (
    <View
      key={p.user_id}
      style={{
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: colors.line,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.heading}>
          {p.profiles?.display_name ?? t('Colleague')}
          {p.user_id === userId ? t(' (you)') : ''}
        </Text>
        <Text style={styles.subtitle}>
          {p.portions} {t(p.portions === 1 ? 'portion' : 'portions')} ·{' '}
          {money(p.portions * event.price_cents)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons
            name={event.price_cents === 0 || p.paid ? 'checkmark-circle-outline' : 'time-outline'}
            size={18}
            color={colors.accent}
            accessible={false}
          />
          <Text style={styles.text}>
            {event.price_cents === 0
              ? t('Free')
              : p.payment_confirmed_at
                ? t('Confirmed')
                : p.paid
                  ? t('Paid')
                  : t('Unpaid')}
          </Text>
        </View>
        {organizer && event.price_cents > 0 && !p.payment_confirmed_at && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Confirm payment for {name}', {
              name: p.profiles?.display_name ?? t('Colleague'),
            })}
            accessibilityState={{ disabled: action.busy }}
            disabled={action.busy}
            onPress={() =>
              action.run(async () => {
                const { error } = await supabase.rpc('confirm_cooking_payment', {
                  event: event.id,
                  participant: p.user_id,
                  expected_portions: p.portions,
                });
                await refresh();
                await notifications.refresh();
                if (error) throw error;
              })
            }
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 10,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: colors.light,
              opacity: action.busy ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name="checkmark-done-outline"
              size={18}
              color={colors.accent}
              accessible={false}
            />
            <Text style={[styles.text, { color: colors.accent }]}>{t('Confirm')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
  const empty = (
    <Empty title={t('The first seat is yours')} detail={t('No one has signed up yet.')} />
  );
  if (!organizer)
    return (
      <InfoDisclosure title={t('At the table ·') + ' ' + participants.length}>
        {!participants.length ? empty : sorted.map(row)}
        {!!event.price_cents && (
          <Text style={styles.subtitle}>
            {t('Paid statuses are self-reported unless confirmed by the organizer.')}
          </Text>
        )}
      </InfoDisclosure>
    );
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('Participants · {count}', { count: participants.length })}
      </Text>
      {event.price_cents > 0 && participants.length > 0 && (
        <>
          <Text style={styles.text}>
            {t('Paid · {count}', { count: paid.length })} · {money(amount(paid))}
          </Text>
          <Text style={styles.text}>
            {t('Awaiting payment · {count}', { count: unpaid.length })} · {money(amount(unpaid))}
          </Text>
          <Text style={styles.subtitle}>
            {t('Paid statuses are self-reported unless confirmed by the organizer.')}
          </Text>
        </>
      )}
      {!participants.length ? (
        empty
      ) : event.price_cents === 0 ? (
        sorted.map(row)
      ) : (
        <>
          {!!unpaid.length && (
            <View style={{ gap: 4 }}>
              <Text style={styles.badge}>{t('Awaiting payment').toUpperCase()}</Text>
              {unpaid.map(row)}
            </View>
          )}
          {!!paid.length && (
            <View style={{ gap: 4 }}>
              <Text style={styles.badge}>{t('Paid').toUpperCase()}</Text>
              {paid.map(row)}
            </View>
          )}
        </>
      )}
      <Notice error={action.error} />
    </Card>
  );
}
