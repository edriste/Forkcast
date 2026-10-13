import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOrganizations } from '../providers/Organizations';
import { useLocale } from '../providers/Locale';
import { Button, useTheme } from './ui';

export function OrganizationSwitcher({ onManage }: { onManage: () => void }) {
  const orgs = useOrganizations();
  const { t } = useLocale();
  const { colors, styles } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const verticalPadding = Math.max(insets.top, insets.bottom) + 16;
  const close = () => setOpen(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Switch organization. Current: {name}', { name: orgs.current!.name })}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          borderRadius: 22,
          backgroundColor: colors.field,
          minHeight: 44,
          maxWidth: Math.max(100, width - 152),
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Ionicons name="business-outline" size={18} color={colors.accent} accessible={false} />
        <Text
          numberOfLines={1}
          style={{ color: colors.ink, fontSize: 18, fontWeight: '600', flexShrink: 1 }}
        >
          {orgs.current!.name}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.ink} accessible={false} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        onRequestClose={close}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: verticalPadding,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Dismiss organization picker')}
            onPress={close}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: 'rgba(0,0,0,0.35)',
            }}
          />
          <View
            role="dialog"
            accessibilityLabel={t('Switch organization')}
            accessibilityViewIsModal
            style={{
              width: Math.min(420, width - 32),
              maxHeight: Math.min(420, height - verticalPadding * 2),
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderWidth: 1,
              borderRadius: 16,
              padding: 12,
              gap: 8,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Text accessibilityRole="header" style={[styles.heading, { flex: 1 }]}>
                {t('Your organizations')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Close organization picker')}
                onPress={close}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="close" size={24} color={colors.ink} accessible={false} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 4 }}
            >
              {orgs.organizations.map((org) => {
                const selected = org.id === orgs.current!.id;
                const choose = () => {
                  close();
                  if (!selected) orgs.select(org.id);
                };
                return (
                  <Pressable
                    key={org.id}
                    accessibilityRole="radio"
                    accessibilityLabel={org.name}
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
                    onPress={choose}
                    {...(Platform.OS === 'web'
                      ? {
                          onKeyDown: (event: React.KeyboardEvent) => {
                            if (event.key === ' ' || event.key === 'Spacebar') {
                              event.preventDefault();
                              event.stopPropagation();
                              choose();
                            }
                          },
                        }
                      : {})}
                    style={({ pressed }) => ({
                      minHeight: 48,
                      padding: 12,
                      borderRadius: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      backgroundColor: selected ? colors.light : colors.surface,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={[styles.text, { flex: 1 }]}>{org.name}</Text>
                    {selected && (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={colors.accent}
                        accessible={false}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button
              title={t('Manage organizations')}
              secondary
              onPress={() => {
                close();
                onManage();
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}
