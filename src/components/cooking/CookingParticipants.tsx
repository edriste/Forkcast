import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import type { CookingEvent, Participant } from '../../lib/types';
import { useLocale } from '../../providers/Locale';
import { useNotifications } from '../../providers/Notifications';
import { Card, Empty, InfoDisclosure, Notice, useAction, useTheme } from '../ui';

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
  const paid = sorted.filter((participant) => participant.paid);
  const unpaid = sorted.filter((participant) => !participant.paid);
  const totalAmount = (items: Participant[]) =>
    items.reduce((sum, participant) => sum + participant.portions * event.price_cents, 0);
  const renderParticipant = (participant: Participant) => (
    <View
      key={participant.user_id}
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
          {participant.profiles?.display_name ?? t('Colleague')}
          {participant.user_id === userId ? t(' (you)') : ''}
        </Text>
        <Text style={styles.subtitle}>
          {participant.portions} {t(participant.portions === 1 ? 'portion' : 'portions')} ·{' '}
          {money(participant.portions * event.price_cents)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons
            name={
              event.price_cents === 0 || participant.paid
                ? 'checkmark-circle-outline'
                : 'time-outline'
            }
            size={18}
            color={colors.accent}
            accessible={false}
          />
          <Text style={styles.text}>
            {event.price_cents === 0
              ? t('Free')
              : participant.payment_confirmed_at
                ? t('Confirmed')
                : participant.paid
                  ? t('Paid')
                  : t('Unpaid')}
          </Text>
        </View>
        {organizer && event.price_cents > 0 && !participant.payment_confirmed_at && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Confirm payment for {name}', {
              name: participant.profiles?.display_name ?? t('Colleague'),
            })}
            accessibilityState={{ disabled: action.busy }}
            disabled={action.busy}
            onPress={() =>
              action.run(async () => {
                const { error } = await supabase.rpc('confirm_cooking_payment', {
                  event: event.id,
                  participant: participant.user_id,
                  expected_portions: participant.portions,
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
        {!participants.length ? empty : sorted.map(renderParticipant)}
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
            {t('Paid · {count}', { count: paid.length })} · {money(totalAmount(paid))}
          </Text>
          <Text style={styles.text}>
            {t('Awaiting payment · {count}', { count: unpaid.length })} ·{' '}
            {money(totalAmount(unpaid))}
          </Text>
          <Text style={styles.subtitle}>
            {t('Paid statuses are self-reported unless confirmed by the organizer.')}
          </Text>
        </>
      )}
      {!participants.length ? (
        empty
      ) : event.price_cents === 0 ? (
        sorted.map(renderParticipant)
      ) : (
        <>
          {!!unpaid.length && (
            <View style={{ gap: 4 }}>
              <Text style={styles.badge}>{t('Awaiting payment').toUpperCase()}</Text>
              {unpaid.map(renderParticipant)}
            </View>
          )}
          {!!paid.length && (
            <View style={{ gap: 4 }}>
              <Text style={styles.badge}>{t('Paid').toUpperCase()}</Text>
              {paid.map(renderParticipant)}
            </View>
          )}
        </>
      )}
      <Notice error={action.error} />
    </Card>
  );
}
