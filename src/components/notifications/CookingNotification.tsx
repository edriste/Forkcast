import { Text, View } from 'react-native';
import { signupClosed } from '../../lib/signupDeadline';
import { useLocale } from '../../providers/Locale';
import { useNotifications, type LunchNotification } from '../../providers/Notifications';
import { Button, Card, IconAction, useAction, useTheme } from '../ui';

type CookingNotificationProps = {
  item: LunchNotification;
  now: number;
  action: ReturnType<typeof useAction>;
  onOpen: (eventId: string, orderId?: string) => void;
  onClose: () => void;
};

const labels: Partial<Record<LunchNotification['kind'], string>> = {
  cooking_reply: 'Cooking discussion reply',
  cooking_scheduled: 'New office cooking',
  payment_due: 'Payment reminder',
  payment_confirmed: 'Payment confirmed',
  cooking_joined: 'New signup',
};

export function CookingNotification({
  item,
  now,
  action,
  onOpen,
  onClose,
}: CookingNotificationProps) {
  const { t, displayDate, money } = useLocale();
  const { styles } = useTheme();
  const inbox = useNotifications();
  const closed = signupClosed(item, now);

  function description() {
    const amount = money((item.portions ?? 0) * item.price_cents);
    const name = item.actor_name;
    switch (item.kind) {
      case 'cooking_reply':
        return t('{name} replied in your cooking discussion.', { name });
      case 'cooking_scheduled':
        return t('{name} scheduled an office lunch.', { name });
      case 'payment_due':
        return t('You haven’t marked {amount} as paid for this lunch.', { amount });
      case 'payment_confirmed':
        return t('{name} confirmed your {amount} payment.', { name, amount });
      case 'cooking_joined':
        return t(
          item.portions === 1
            ? '{name} joined your lunch · 1 portion.'
            : '{name} joined your lunch · {count} portions.',
          { name, count: item.portions ?? 0 },
        );
      default:
        return t('{name} marked {amount} as paid (self-reported).', { name, amount });
    }
  }

  return (
    <Card>
      <Text style={styles.badge}>
        {t(labels[item.kind] ?? 'Payment update')}
        {!item.read_at ? ` · ${t('Unread')}` : ''}
      </Text>
      <Text style={styles.heading}>{item.title ?? t('Office lunch')}</Text>
      <Text style={styles.subtitle}>{displayDate(item.meal_date)}</Text>
      <Text style={styles.text}>{description()}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            title={t(
              item.kind === 'payment_due' || item.kind === 'payment_confirmed'
                ? 'View lunch & payment'
                : 'View lunch',
            )}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                await inbox.update(item.id);
                onClose();
                onOpen(item.event_id!);
              })
            }
          />
        </View>
        {item.kind === 'cooking_scheduled' && !closed && (
          <IconAction
            icon="person-add-outline"
            title={t('Join · 1 portion')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                await inbox.join(item.id);
                onClose();
                onOpen(item.event_id!);
              })
            }
          />
        )}
        {item.kind !== 'payment_due' && (
          <IconAction
            icon="close-outline"
            title={t('Dismiss notification')}
            busy={action.busy}
            onPress={() => action.run(() => inbox.update(item.id, true))}
          />
        )}
      </View>
      {item.kind === 'cooking_scheduled' && closed && (
        <Text style={styles.subtitle}>{t('Signup closed')}</Text>
      )}
    </Card>
  );
}
