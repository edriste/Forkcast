import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { compactLocationLabel } from '../../supabase/functions/_shared/location';
import { Button, Card, Field, Notice, Page, useAction, useTheme } from '../components/ui';
import { Dialog } from '../components/ui/Dialog';
import { menuUrl } from '../lib/orders';
import { paypalHandle } from '../lib/payments';
import { deadlineFields, parseBerlinDeadline } from '../lib/signupDeadline';
import { supabase } from '../lib/supabase';
import { useResource } from '../lib/useResource';
import type { RootStackParams } from '../navigation';
import { useSession } from '../providers/Auth';
import { useLocale } from '../providers/Locale';
import { useOrganizations } from '../providers/Organizations';
export function CreateOrderScreen({
  navigation,
}: NativeStackScreenProps<RootStackParams, 'CreateOrder'>) {
  const org = useOrganizations().current!;
  const { t } = useLocale();
  const { styles } = useTheme();
  const action = useAction();
  const user = useSession().user.id;
  const [organizer, setOrganizer] = useState(user);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [search, setSearch] = useState('');
  const people = useResource(
    useCallback(async () => {
      const all: { user_id: string; profiles: { display_name: string } | null }[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from('organization_memberships')
          .select('user_id,profiles(display_name)')
          .eq('organization_id', org.id)
          .order('user_id')
          .range(offset, offset + 499);
        if (error) throw error;
        all.push(...(data as unknown as typeof all));
        if (data.length < 500) break;
      }
      return all;
    }, [org.id]),
    ['organization'],
  );

  const initial = deadlineFields(new Date(Date.now() + 30 * 60000).toISOString());
  const [day, setDay] = useState(initial.date);
  const [restaurant, setRestaurant] = useState('');
  const [menu, setMenu] = useState('');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [address, setAddress] = useState(
    compactLocationLabel(org.location_label ?? org.search_area),
  );
  const [notes, setNotes] = useState('');
  const [paypal, setPaypal] = useState('');
  return (
    <Page>
      <Text style={styles.title}>{t('Order lunch together.')}</Text>
      <Text style={styles.subtitle}>
        {t(
          'Everyone adds their choices. You place the final order using the restaurant’s website or delivery app.',
        )}
      </Text>
      <Card>
        <Button
          secondary
          title={t('Person placing the order: {name}', {
            name:
              people.data?.find((person) => person.user_id === organizer)?.profiles?.display_name ??
              t('You'),
          })}
          onPress={() => setPeopleOpen(true)}
        />

        <Field
          label={t('Restaurant')}
          value={restaurant}
          onChangeText={setRestaurant}
          maxLength={120}
        />
        <Field
          label={t('Menu link')}
          value={menu}
          onChangeText={setMenu}
          autoCapitalize="none"
          maxLength={2000}
          keyboardType="url"
        />
        <Field
          label={t('Order date (YYYY-MM-DD)')}
          value={day}
          onChangeText={setDay}
          maxLength={10}
        />
        <Text style={styles.heading}>{t('Order deadline')}</Text>
        <Text style={styles.subtitle}>{t('Times are in Berlin time.')}</Text>
        <Field
          label={t('Deadline date (YYYY-MM-DD)')}
          value={date}
          onChangeText={setDate}
          maxLength={10}
        />
        <Field
          label={t('Deadline time (HH:mm)')}
          value={time}
          onChangeText={setTime}
          maxLength={5}
        />
        <Field
          label={t('Delivery address')}
          value={address}
          onChangeText={setAddress}
          maxLength={500}
        />
        <Field
          label={t('Delivery instructions (optional)')}
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={1000}
        />
        <Field
          label={t('PayPal.me handle (optional)')}
          value={paypal}
          onChangeText={setPaypal}
          autoCapitalize="none"
        />
        <Notice error={action.error} />
        <Button
          title={t('Start group order')}
          busy={action.busy}
          onPress={() =>
            action.run(async () => {
              const { data, error } = await supabase.rpc('create_office_order_for_member', {
                organizer,
                org: org.id,
                meal_date: day,
                restaurant_name: restaurant,
                menu: menuUrl(menu),
                deadline: parseBerlinDeadline(date, time),
                address,
                instructions: notes,
                paypal: paypal.trim() ? paypalHandle(paypal) : null,
              });
              if (error) throw error;
              navigation.replace('Order', { orderId: data });
            })
          }
        />
      </Card>
      <Dialog
        visible={peopleOpen}
        title={t('Who places the order?')}
        closeLabel={t('Close order dialog')}
        onClose={() => setPeopleOpen(false)}
      >
        <Notice error={people.error} />
        {people.error && <Button secondary title={t('Retry members')} onPress={people.reload} />}
        {(people.data?.length ?? 0) > 8 && (
          <Field label={t('Search members')} value={search} onChangeText={setSearch} />
        )}
        {people.data
          ?.filter((person) =>
            (person.profiles?.display_name ?? '')
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
          )
          .map((person) => (
            <Pressable
              key={person.user_id}
              accessibilityRole="radio"
              accessibilityLabel={person.profiles?.display_name ?? t('Colleague')}
              accessibilityState={{ checked: organizer === person.user_id }}
              aria-checked={organizer === person.user_id}
              onPress={() => {
                setOrganizer(person.user_id);
                setPeopleOpen(false);
              }}
              style={{ minHeight: 48, justifyContent: 'center' }}
            >
              <Text style={styles.text}>
                {organizer === person.user_id ? '✓ ' : ''}
                {person.profiles?.display_name ?? t('Colleague')}
              </Text>
            </Pressable>
          ))}
      </Dialog>
    </Page>
  );
}
