import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Chip, Empty, ItemRow, Notice, Page, useTheme } from '../components/ui';
import { localDate } from '../lib/format';
import { officeOrders, orderStatusLabel } from '../lib/orders';
import { useResource } from '../lib/useResource';
import { useSignupClock } from '../lib/useSignupClock';
import type { RootStackParams } from '../navigation';
import { useLocale } from '../providers/Locale';
import { useOrganizations } from '../providers/Organizations';
export function OrdersScreen({ navigation }: NativeStackScreenProps<RootStackParams, 'Orders'>) {
  const org = useOrganizations().current!.id;
  const { t, displayDate } = useLocale();
  const { styles } = useTheme();
  const [past, setPast] = useState(false);
  const pages = useRef(1);
  const now = useSignupClock([]);
  const day = localDate(new Date(now));
  const resource = useResource(
    useCallback(async () => {
      const orders = [];
      for (let page = 0; page < pages.current; page++) {
        const batch = await officeOrders(org, day, past, page);
        orders.push(...batch);
        if (batch.length < 30) break;
      }
      return orders;
    }, [org, day, past]),
    ['orders', 'organization'],
  );
  const clock = useSignupClock(resource.data?.map((order) => order.signup_deadline) ?? []);
  return (
    <Page>
      <Text style={styles.title}>{t('Office orders')}</Text>
      <Button title={t('Start group order')} onPress={() => navigation.navigate('CreateOrder')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[false, true].map((value) => (
          <Chip
            key={String(value)}
            label={t(value ? 'Past orders' : 'Upcoming orders')}
            selected={past === value}
            onPress={() => {
              pages.current = 1;
              setPast(value);
            }}
          />
        ))}
      </View>
      <Notice error={resource.error} />
      {resource.error && <Button secondary title={t('Retry orders')} onPress={resource.reload} />}
      {!resource.loading && !resource.error && !resource.data?.length && (
        <Empty
          title={t('No group orders yet')}
          detail={t('Start an order and collect everyone’s choices in one place.')}
        />
      )}
      {resource.data?.map((order) => (
        <ItemRow
          key={order.id}
          title={order.restaurant}
          detail={`${displayDate(order.order_date)} · ${t(orderStatusLabel(order, clock))}`}
          label={t('View order from {name}', { name: order.restaurant })}
          onPress={() => navigation.navigate('Order', { orderId: order.id })}
        />
      ))}
      {!!resource.data?.length && resource.data.length % 30 === 0 && (
        <Button
          secondary
          title={t('Load more')}
          busy={resource.loading}
          onPress={() => {
            pages.current++;
            void resource.reload();
          }}
        />
      )}
    </Page>
  );
}
