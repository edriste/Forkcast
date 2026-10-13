import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFavorites } from '../providers/Favorites';
import { useLocale } from '../providers/Locale';
import { useTheme } from './ui';
export function FavoriteButton({ id, name }: { id: string; name: string }) {
  const favorites = useFavorites();
  const { t } = useLocale();
  const { colors } = useTheme();
  const saved = favorites.ids.includes(id);
  const disabled = favorites.loading || favorites.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(saved ? 'Remove {name} from favorites' : 'Save {name} to favorites', {
        name,
      })}
      accessibilityState={{ selected: saved, disabled }}
      aria-pressed={saved}
      disabled={disabled}
      onPress={() => {
        void favorites.setFavorite(id, !saved);
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 15,
        backgroundColor: saved ? colors.orange : colors.light,
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
      })}
    >
      <Ionicons
        name={saved ? 'bookmark' : 'bookmark-outline'}
        size={22}
        color={saved ? colors.onOrange : colors.accent}
        accessible={false}
      />
    </Pressable>
  );
}
