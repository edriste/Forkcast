import { Text, View } from 'react-native';
import { useLocale } from '../../providers/Locale';
import { useNotifications, type LunchNotification } from '../../providers/Notifications';
import { Button, Card, IconAction, useAction, useTheme } from '../ui';

const labels: Record<string, string> = {
  order_started: 'New group order',
  order_deadline: 'Order deadline reminder',
  order_placed: 'Order placed',
  order_arrived: 'Food has arrived',
  order_payment_due: 'Payment reminder',
  order_payment_received: 'Payment update',
  order_payment_confirmed: 'Payment confirmed',
};
const messages: Record<string, string> = {
  order_started: '{name} started a group order. Add your choices before the deadline.',
  order_deadline: 'Your choices are not marked ready. The order deadline is approaching.',
  order_placed: 'The group order has been placed. Your total is {amount}.',
  order_arrived: 'Your group order has arrived.',
  order_payment_due: 'You haven’t marked {amount} as paid for this order.',
  order_payment_received: '{name} marked {amount} as paid (self-reported).',
  order_payment_confirmed: '{name} confirmed your {amount} payment.',
};

export function OrderNotification({
  item,
  onOpen,
  onClose,
}: {
  item: LunchNotification;
  onOpen: (eventId: string, orderId?: string) => void;
  onClose: () => void;
}) {
  const { t, money, displayDate } = useLocale();
  const { styles } = useTheme();
  const inbox = useNotifications();
  const action = useAction();
  return (
    <Card>
      <Text style={styles.badge}>
        {t(labels[item.kind] ?? 'Group order')}
        {!item.read_at ? ` · ${t('Unread')}` : ''}
      </Text>
      <Text style={styles.heading}>{item.title}</Text>
      <Text style={styles.subtitle}>{displayDate(item.meal_date)}</Text>
      <Text style={styles.text}>
        {t(messages[item.kind] ?? 'Group order', {
          name: item.actor_name,
          amount: money(item.price_cents),
        })}
      </Text>
      {action.error && <Text style={styles.error}>{t(action.error)}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            title={t('View group order')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                await inbox.update(item.id);
                onClose();
                onOpen('', item.order_id!);
              })
            }
          />
        </View>
        {item.kind !== 'order_payment_due' && (
          <IconAction
            title={t('Dismiss notification')}
            icon="close-outline"
            busy={action.busy}
            onPress={() => action.run(() => inbox.update(item.id, true))}
          />
        )}
      </View>
    </Card>
  );
}
