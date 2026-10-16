import { formatDistance } from '../lib/distance';
import { IconAction } from './compact';
import { useLocale } from '../providers/Locale';
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
import { categoryName } from '../lib/reviews';
import { Field, useTheme } from './ui';

type Filter = 'category' | 'rating' | 'distance' | 'sort';
export function PlaceFilters({
  categories,
  category,
  setCategory,
  minimum,
  setMinimum,
  maximumDistance,
  setMaximumDistance,
  sort,
  setSort,
  distanceAvailable,
}: {
  categories: string[];
  category: string;
  setCategory: (value: string) => void;
  minimum: number;
  setMinimum: (value: number) => void;
  maximumDistance: number;
  setMaximumDistance: (value: number) => void;
  sort: 'rating' | 'nearest';
  setSort: (value: 'rating' | 'nearest') => void;
  distanceAvailable: boolean;
}) {
  const { t, number, locale } = useLocale();

  const { colors, styles } = useTheme();
  const [open, setOpen] = useState<Filter | null>(null);
  const [search, setSearch] = useState('');
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const categoryOptions = [...new Set([...categories, ...(category !== 'All' ? [category] : [])])];
  const filters = [
    {
      id: 'category' as const,
      title: t('Cuisine'),
      label: category === 'All' ? t('All cuisines') : t(categoryName(category)),
      active: category !== 'All',
    },
    {
      id: 'rating' as const,
      title: t('Rating'),
      label: minimum
        ? t('{0}+ stars', { 0: number(minimum).replace(/[.,]0$/, '') })
        : t('Any rating'),
      active: minimum !== 0,
    },
    {
      id: 'distance' as const,
      title: t('Distance'),
      label:
        maximumDistance && distanceAvailable
          ? t('Within {distance}', { distance: formatDistance(maximumDistance, locale) })
          : t('Any distance'),
      active: maximumDistance !== 0 && distanceAvailable,
    },
    {
      id: 'sort' as const,
      title: t('Sort'),
      label: t(sort === 'nearest' && distanceAvailable ? 'Nearest first' : 'Best rated'),
      active: sort === 'nearest' && distanceAvailable,
    },
  ];
  const current = filters.find((filter) => filter.id === open);
  const options =
    open === 'category'
      ? [
          { value: 'All', label: t('All cuisines') },
          ...categoryOptions.map((value) => ({ value, label: t(categoryName(value)) })),
        ].filter(
          (option) =>
            option.value === 'All' ||
            option.label.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : open === 'rating'
        ? [0, 3, 4, 4.5].map((value) => ({
            value: String(value),
            label: value
              ? t('{0}+ stars', { 0: number(value).replace(/[.,]0$/, '') })
              : t('Any rating'),
          }))
        : open === 'distance'
          ? [0, 500, 1000, 2000, 3000]
              .filter((value) => !value || distanceAvailable)
              .map((value) => ({
                value: String(value),
                label: value
                  ? t('Within {distance}', { distance: formatDistance(value, locale) })
                  : t('Any distance'),
              }))
          : open === 'sort'
            ? [
                { value: 'rating', label: t('Best rated') },
                ...(distanceAvailable ? [{ value: 'nearest', label: t('Nearest first') }] : []),
              ]
            : [];
  const selected =
    open === 'category'
      ? category
      : open === 'distance'
        ? String(distanceAvailable ? maximumDistance : 0)
        : open === 'sort'
          ? distanceAvailable
            ? sort
            : 'rating'
          : String(minimum);
  function choose(value: string) {
    if (open === 'category') setCategory(value);
    else if (open === 'rating') setMinimum(Number(value));
    else if (open === 'distance') setMaximumDistance(Number(value));
    else if (open === 'sort') setSort(value === 'nearest' ? 'nearest' : 'rating');
    setOpen(null);
  }
  return (
    <View style={{ gap: 6 }}>
      <View
        accessibilityLabel={t('Lunch spot filters')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        {filters.map((filter) =>
          filter.id === 'sort' ? (
            <IconAction
              key={filter.id}
              title={t('{0}: {1}', { 0: filter.title, 1: filter.label })}
              icon="swap-vertical-outline"
              selected={filter.active}
              onPress={() => setOpen('sort')}
            />
          ) : (
            <Pressable
              key={filter.id}
              accessibilityRole="button"
              accessibilityLabel={t('{0}: {1}', { 0: t(filter.title), 1: t(filter.label) })}
              accessibilityState={{ expanded: open === filter.id }}
              onPress={() => {
                setSearch('');
                setOpen(filter.id);
              }}
              style={({ pressed }) => ({
                flex: 1,
                minWidth: 0,
                minHeight: 56,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: filter.active ? colors.orange : colors.line,
                backgroundColor: filter.active ? colors.light : colors.surface,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '600' }}>
                {filter.title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: filter.active ? colors.accent : colors.ink,
                    fontSize: 13,
                    fontWeight: '600',
                  }}
                >
                  {filter.label}
                </Text>
                <Text
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={{ color: colors.muted }}
                >
                  ⌄
                </Text>
              </View>
            </Pressable>
          ),
        )}
      </View>
      {filters.some((filter) => filter.active) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Reset filters')}
          onPress={() => {
            setCategory('All');
            setMinimum(0);
            setMaximumDistance(0);
            setSort('rating');
          }}
          style={{
            alignSelf: 'flex-end',
            minHeight: 44,
            paddingHorizontal: 8,
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>
            {t('Reset filters')}
          </Text>
        </Pressable>
      )}
      <Modal
        visible={open !== null}
        transparent
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        onRequestClose={() => setOpen(null)}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View
          style={{
            flex: 1,
            justifyContent: width < 600 ? 'flex-end' : 'center',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Dismiss filter options')}
            onPress={() => setOpen(null)}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          />
          <View
            role="dialog"
            accessibilityLabel={t('{0} filter', { 0: current?.title ?? '' })}
            accessibilityViewIsModal
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: Math.min(height * 0.75, height - insets.top - insets.bottom - 32),
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderWidth: 1,
              borderRadius: 20,
              padding: 16,
              gap: 8,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text accessibilityRole="header" style={styles.heading}>
                {current?.title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Close filter options')}
                onPress={() => setOpen(null)}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: colors.ink, fontSize: 26 }}>×</Text>
              </Pressable>
            </View>
            {(open === 'distance' || open === 'sort') && (
              <Text style={styles.subtitle}>
                {t(
                  distanceAvailable
                    ? 'Walking distances from your office when available; straight-line estimates are labelled separately.'
                    : 'Set an office location to calculate distances.',
                )}
              </Text>
            )}
            {open === 'category' && categoryOptions.length > 8 && (
              <Field
                label={t('Search cuisines')}
                value={search}
                onChangeText={setSearch}
                placeholder={t('Find a cuisine')}
              />
            )}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ gap: 4 }}
            >
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: selected === option.value }}
                  onPress={() => choose(option.value)}
                  {...(Platform.OS === 'web'
                    ? {
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key === ' ' || event.key === 'Spacebar') {
                            event.preventDefault();
                            event.stopPropagation();
                            choose(option.value);
                          }
                        },
                      }
                    : {})}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    borderRadius: 10,
                    padding: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    backgroundColor: selected === option.value ? colors.light : colors.surface,
                    opacity: pressed ? 0.75 : 1,
                  })}
                >
                  <Text style={[styles.text, { flex: 1 }]}>{option.label}</Text>
                  <Text
                    style={{ color: colors.accent, fontSize: 18 }}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {selected === option.value ? '●' : '○'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
