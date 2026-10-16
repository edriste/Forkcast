import { useLocale } from '../providers/Locale';
import React, { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { Text, View } from 'react-native';
import type { Reviewed } from '../lib/reviews';
import { mapBounds } from '../../supabase/functions/_shared/osm';
import { Notice, useTheme } from './ui';
import { useMapStyle } from './useMapStyle';
import { OSMAttribution } from './OSMAttribution';
export function ReviewedMap({
  places,
  onSelect,
  office,
  onPick,
}: {
  places: Reviewed[];
  onSelect?: (place: Reviewed) => void;
  office?: { name: string; latitude: number; longitude: number };
  onPick?: (latitude: number, longitude: number) => void;
}) {
  const { t, number } = useLocale();

  const { colors, styles } = useTheme();

  const camera = useRef<CameraRef>(null);
  const [mapError, setMapError] = useState('');
  const resource = useMapStyle();
  const bounds = mapBounds([...places.map((item) => item.place), ...(office ? [office] : [])]);
  const fit = () => {
    if (bounds)
      camera.current?.fitBounds(bounds, {
        padding: { top: 45, right: 45, bottom: 45, left: 45 },
        duration: 300,
      });
  };
  useEffect(fit, [places, office?.latitude, office?.longitude]);
  return (
    <View style={{ gap: 8 }}>
      <Notice error={resource.error || mapError} />
      {!resource.style && !resource.error && (
        <Text style={styles.subtitle}>{t('Loading map…')}</Text>
      )}
      {resource.style && bounds && (
        <Map
          mapStyle={resource.style as ComponentProps<typeof Map>['mapStyle']}
          style={{ width: '100%', height: 360, borderRadius: 18 }}
          attribution
          onPress={
            onPick
              ? (event) => {
                  const [longitude, latitude] = event.nativeEvent.lngLat;
                  onPick(latitude, longitude);
                }
              : undefined
          }
          onDidFinishLoadingMap={fit}
          onDidFailLoadingMap={() =>
            setMapError('Map tiles could not be loaded. Switch to the list view to read reviews.')
          }
        >
          <Camera
            ref={camera}
            initialViewState={{ bounds, padding: { top: 45, right: 45, bottom: 45, left: 45 } }}
            maxZoom={18}
          />
          {office && (
            <Marker id="organization-office" lngLat={[office.longitude, office.latitude]}>
              <View
                accessibilityLabel={t('Organization location: {0}', { 0: office.name })}
                style={{
                  backgroundColor: colors.office,
                  borderRadius: 12,
                  padding: 10,
                  borderWidth: 2,
                  borderColor: colors.markerBorder,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Ionicons
                  name="business-outline"
                  size={18}
                  color={colors.onOffice}
                  accessible={false}
                />
                <Text style={{ color: colors.onOffice, fontWeight: '700' }}>{office.name}</Text>
              </View>
            </Marker>
          )}
          {places
            .filter((item) => item.place.latitude !== null && item.place.longitude !== null)
            .map((item) => (
              <Marker
                key={item.place.id}
                id={item.place.id}
                lngLat={[item.place.longitude!, item.place.latitude!]}
                onPress={() => onSelect?.(item)}
              >
                <View
                  accessibilityRole="button"
                  accessibilityLabel={t('{0}, {1} stars', {
                    0: item.place.name,
                    1: number(Number(item.aggregate.average)),
                  })}
                  style={{
                    backgroundColor: colors.orange,
                    borderRadius: 24,
                    padding: 10,
                    borderWidth: 2,
                    borderColor: colors.markerBorder,
                  }}
                >
                  <Text style={{ color: colors.onOrange, fontWeight: '700' }}>
                    ★ {number(Number(item.aggregate.average))}
                  </Text>
                </View>
              </Marker>
            ))}
        </Map>
      )}
      <OSMAttribution maps places={places.map((item) => item.place)} />
    </View>
  );
}
