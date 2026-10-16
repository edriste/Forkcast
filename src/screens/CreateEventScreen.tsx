import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MealFlagPicker } from '../components/cooking/MealFlags';
import { SignupDeadlineFields, type DeadlineDraft } from '../components/cooking/SignupDeadline';
import { Button, Card, Chip, Field, Notice, Page, useAction, useTheme } from '../components/ui';
import { localDate } from '../lib/cooking';
import type { MealFlag } from '../lib/mealFlags';
import { parsePrice, paypalHandle } from '../lib/payments';
import { parseBerlinDeadline } from '../lib/signupDeadline';
import { supabase } from '../lib/supabase';
import type { RootStackParams } from '../navigation';
import { useLocale } from '../providers/Locale';
import { useOrganizations } from '../providers/Organizations';
export function CreateEventScreen({
  navigation,
}: NativeStackScreenProps<RootStackParams, 'CreateEvent'>) {
  const { t } = useLocale();

  const { styles } = useTheme();

  const org = useOrganizations().current!;
  const action = useAction();
  const [date, setDate] = useState(localDate());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [flags, setFlags] = useState<MealFlag[]>([]);
  const [deadline, setDeadline] = useState<DeadlineDraft>({
    enabled: false,
    date: localDate(),
    time: '11:00',
  });
  useEffect(() => {
    if (!deadline.enabled) setDeadline((value) => ({ ...value, date }));
  }, [date, deadline.enabled]);
  const [limited, setLimited] = useState(false);
  const [limit, setLimit] = useState('');
  const [price, setPrice] = useState('0');
  const [paypal, setPaypal] = useState('');
  return (
    <Page>
      <Text style={styles.title}>{t('Make room for lunch.')}</Text>
      <Text style={styles.subtitle}>{t('You cook. Your colleagues pull up a chair.')}</Text>
      <Card>
        <Field
          label={t('Date (YYYY-MM-DD)')}
          value={date}
          onChangeText={setDate}
          maxLength={10}
          placeholder="2026-10-12"
        />
        <Field
          label={t('Meal name (optional)')}
          value={title}
          onChangeText={setTitle}
          maxLength={120}
          placeholder={t('e.g. A big pot of lentil curry')}
        />
        <Field
          label={t('Description (optional)')}
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={4000}
          placeholder={t('What’s on the menu? Include allergens if helpful.')}
        />
        <Text style={styles.label}>{t('Meal tags (optional)')}</Text>
        <MealFlagPicker value={flags} onChange={setFlags} disabled={action.busy} />
        <Text style={styles.label}>{t('Portions')}</Text>
        <View style={styles.row}>
          <Chip label={t('Unlimited')} selected={!limited} onPress={() => setLimited(false)} />
          <Chip label={t('Set a limit')} selected={limited} onPress={() => setLimited(true)} />
        </View>
        {limited && (
          <Field
            label={t('Maximum portions')}
            value={limit}
            onChangeText={setLimit}
            keyboardType="number-pad"
          />
        )}
        <SignupDeadlineFields value={deadline} onChange={setDeadline} disabled={action.busy} />
        <Field
          label={t('Price per portion (EUR)')}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
        />
        <Field
          label={t('PayPal.me username or link (required for paid lunches)')}
          value={paypal}
          onChangeText={setPaypal}
          autoCapitalize="none"
          placeholder="https://paypal.me/yourname"
        />
        <Notice error={action.error} />
        <Button
          title={t('Create lunch')}
          busy={action.busy}
          onPress={() =>
            action.run(async () => {
              if (
                !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                Number.isNaN(Date.parse(date)) ||
                new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date ||
                date < localDate()
              )
                throw new Error('Choose today or a future date in YYYY-MM-DD format.');
              if (limited && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 10000))
                throw new Error('Choose a portion limit between 1 and 10000.');
              const cents = parsePrice(price);
              const handle = cents > 0 ? paypalHandle(paypal) : null;
              const { data, error } = await supabase.rpc('create_cooking_event', {
                org: org.id,
                event_date: date,
                meal_title: title,
                meal_description: description,
                portion_limit: limited ? Number(limit) : null,
                portion_price: cents,
                paypal: handle,
                meal_flags: flags,
                signup_until: deadline.enabled
                  ? parseBerlinDeadline(deadline.date, deadline.time)
                  : null,
              });
              if (error) throw error;
              navigation.replace('Event', { eventId: data });
            })
          }
        />
      </Card>
    </Page>
  );
}
