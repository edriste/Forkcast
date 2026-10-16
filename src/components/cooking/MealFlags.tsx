import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { mealFlags, type MealFlag } from '../../lib/mealFlags';
import { supabase } from '../../lib/supabase';
import type { CookingEvent } from '../../lib/types';
import { useLocale } from '../../providers/Locale';
import { Button, Notice, useAction, useTheme } from '../ui';

export function MealFlagBadges({ flags = [] }: { flags?: MealFlag[] }) {
  const { t } = useLocale();
  const { colors } = useTheme();
  if (!flags.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {mealFlags
        .filter((flag) => flags.includes(flag.id))
        .map((flag) => (
          <View
            key={flag.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: 10,
              backgroundColor: colors.light,
            }}
          >
            <Ionicons name={flag.icon} size={14} color={colors.accent} accessible={false} />
            <Text style={{ fontSize: 12, color: colors.ink, fontWeight: '600' }}>
              {t(flag.label)}
            </Text>
          </View>
        ))}
    </View>
  );
}

export function MealFlagPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: MealFlag[];
  onChange: (value: MealFlag[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const { colors, styles } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {mealFlags.map((flag) => {
        const selected = value.includes(flag.id);
        return (
          <Pressable
            key={flag.id}
            accessibilityRole="checkbox"
            accessibilityLabel={t(flag.label)}
            accessibilityState={{ checked: selected, disabled }}
            aria-checked={selected}
            disabled={disabled}
            onPress={() =>
              onChange(selected ? value.filter((id) => id !== flag.id) : [...value, flag.id])
            }
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: selected ? colors.orange : colors.field,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Ionicons
              name={selected ? 'checkmark' : flag.icon}
              size={18}
              color={selected ? colors.onOrange : colors.accent}
              accessible={false}
            />
            <Text style={[styles.text, { color: selected ? colors.onOrange : colors.ink }]}>
              {t(flag.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MealFlagsEditor({
  event,
  organizer,
  onSaved,
}: {
  event: CookingEvent;
  organizer: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const { styles, colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MealFlag[]>(event.flags ?? []);
  const dirty = useRef(false);
  const action = useAction();
  useEffect(() => {
    if (!dirty.current) setDraft(event.flags ?? []);
  }, [event.flags]);
  if (!organizer) return <MealFlagBadges flags={event.flags} />;
  return (
    <View style={{ gap: 8 }}>
      {!editing && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <MealFlagBadges flags={event.flags} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Edit meal tags')}
            accessibilityState={{ disabled: action.busy }}
            disabled={action.busy}
            onPress={() => {
              setDraft(event.flags ?? []);
              dirty.current = false;
              setEditing(true);
            }}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderRadius: 12,
              opacity: action.busy ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name={event.flags?.length ? 'create-outline' : 'add-circle-outline'}
              size={18}
              color={colors.accent}
              accessible={false}
            />
            <Text style={[styles.text, { color: colors.accent }]}>
              {t(event.flags?.length ? 'Edit meal tags' : 'Add meal tags')}
            </Text>
          </Pressable>
        </View>
      )}
      {editing && (
        <>
          <Text style={styles.label}>{t('Meal tags (optional)')}</Text>
          <MealFlagPicker
            value={draft}
            disabled={action.busy}
            onChange={(value) => {
              dirty.current = true;
              setDraft(value);
            }}
          />
          <Notice error={action.error} />
          <Button
            title={t('Save meal tags')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                const { error } = await supabase.rpc('set_cooking_flags', {
                  event: event.id,
                  meal_flags: draft,
                });
                if (error) throw error;
                dirty.current = false;
                setEditing(false);
                await onSaved();
              })
            }
          />
          <Button
            secondary
            title={t('Cancel')}
            disabled={action.busy}
            onPress={() => {
              dirty.current = false;
              setDraft(event.flags ?? []);
              setEditing(false);
            }}
          />
        </>
      )}
    </View>
  );
}
