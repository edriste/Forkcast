import { useNotifications } from '../providers/Notifications';
import { useLocale } from '../providers/Locale';
import React from 'react';
import { Linking, Text } from 'react-native';
import { paypalLink } from '../lib/payments';
import { supabase } from '../lib/supabase';
import type { CookingEvent, Participant } from '../lib/types';
import { Button, Card, Notice, useAction, useTheme } from './ui';
export function EventPayment({
  event,
  participant,
  refresh,
}: {
  event: CookingEvent;
  participant: Participant;
  refresh: () => Promise<void>;
}) {
  const { t, money } = useLocale();

  const { styles } = useTheme();

  const action = useAction();
  const notifications = useNotifications();
  if (!event.price_cents)
    return (
      <Card>
        <Text style={styles.heading}>{t('This lunch is on the house.')}</Text>
        <Text style={styles.subtitle}>{t('No payment needed.')}</Text>
      </Card>
    );
  if (participant.payment_confirmed_at)
    return (
      <Card>
        <Text style={styles.heading}>{t('Your lunch payment')}</Text>
        <Text style={styles.text}>
          {t('Confirmed · {amount}', { amount: money(participant.portions * event.price_cents) })}
        </Text>
        <Text style={styles.subtitle}>{t('Payment has been confirmed by the organizer.')}</Text>
      </Card>
    );
  return (
    <Card>
      <Text style={styles.heading}>{t('Your lunch payment')}</Text>
      <Text style={styles.text}>
        {participant.portions} × {money(event.price_cents)} ={' '}
        {money(participant.portions * event.price_cents)}
      </Text>
      <Text style={styles.subtitle}>
        {t('PayPal recipient:')} {event.paypal_handle}
      </Text>
      <Button
        title={t('Pay {0} with PayPal', { 0: money(participant.portions * event.price_cents) })}
        busy={action.busy}
        onPress={() =>
          action.run(async () => {
            await Linking.openURL(
              paypalLink(event.paypal_handle!, participant.portions, event.price_cents),
            );
          })
        }
      />
      <Text style={styles.subtitle}>
        {t(
          'Confirm the recipient and amount in PayPal, then mark yourself as paid here. Payment is not automatically verified.',
        )}
      </Text>
      <Button
        secondary
        title={participant.paid ? t('Marked paid — undo') : t('I have paid')}
        busy={action.busy}
        onPress={() =>
          action.run(async () => {
            const { error } = await supabase.rpc('mark_payment', {
              event: event.id,
              is_paid: !participant.paid,
            });
            if (error) throw error;
            await notifications.refresh();
            await refresh();
          })
        }
      />
      <Notice error={action.error} />
    </Card>
  );
}
