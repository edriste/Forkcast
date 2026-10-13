import { useLocale } from '../providers/Locale';
import React, { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Map, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map-theme.css';
import { View } from 'react-native';
import type { Reviewed } from '../lib/reviews';
import { mapBounds } from '../../supabase/functions/_shared/osm';
import { Notice, useTheme } from './ui';
import { useMapStyle } from './useMapStyle';
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

  const { colors, dark } = useTheme();

  const container = useRef<HTMLDivElement>(null);
  const resource = useMapStyle();
  const [error, setError] = useState('');
  const select = useRef(onSelect);
  select.current = onSelect;
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    if (!container.current || !resource.style) return;
    const bounds = mapBounds([...places.map((item) => item.place), ...(office ? [office] : [])]);
    if (!bounds) return;
    setWorkerUrl('/maplibre-worker.js');
    let map: Map;
    try {
      map = new Map({
        container: container.current,
        style: resource.style,
        bounds: [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        fitBoundsOptions: { padding: 45, maxZoom: 17 },
        attributionControl: { compact: false },
        locale: {
          'AttributionControl.ToggleAttribution': t('Toggle attribution'),
          'AttributionControl.MapFeedback': t('Map feedback'),
        },
      });
      map.on('error', () =>
        setError('Map tiles could not be loaded. Switch to the list view to read reviews.'),
      );
      if (pick.current)
        map.on('click', (event) => pick.current?.(event.lngLat.lat, event.lngLat.lng));
      if (office) {
        const marker = document.createElement('div');
        const icon = document.createElement('span');
        const glyph = Ionicons.glyphMap['business-outline'];
        icon.textContent = typeof glyph === 'number' ? String.fromCodePoint(glyph) : glyph;
        icon.setAttribute('aria-hidden', 'true');
        Object.assign(icon.style, {
          fontFamily: Ionicons.getFontFamily(),
          fontSize: '18px',
          fontWeight: '400',
          lineHeight: '18px',
          width: '18px',
          height: '18px',
          flexShrink: '0',
        });
        const name = document.createElement('span');
        name.textContent = office.name;
        marker.append(icon, name);
        void Ionicons.loadFont().catch(() => {});
        marker.setAttribute('aria-label', t('Organization location: {0}', { 0: office.name }));
        Object.assign(marker.style, {
          background: colors.office,
          color: colors.onOffice,
          border: `2px solid ${colors.markerBorder}`,
          borderRadius: '12px',
          padding: '10px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        });
        new Marker({ element: marker }).setLngLat([office.longitude, office.latitude]).addTo(map);
      }
      places
        .filter((item) => item.place.latitude !== null && item.place.longitude !== null)
        .forEach((item) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `★ ${number(Number(item.aggregate.average))}`;
          button.setAttribute(
            'aria-label',
            t('{0}, {1} stars', { 0: item.place.name, 1: number(Number(item.aggregate.average)) }),
          );
          Object.assign(button.style, {
            background: colors.orange,
            color: colors.onOrange,
            border: `2px solid ${colors.markerBorder}`,
            borderRadius: '18px',
            padding: '10px',
            fontWeight: '700',
            cursor: 'pointer',
          });
          button.addEventListener('click', () => select.current?.(item));
          new Marker({ element: button })
            .setLngLat([item.place.longitude!, item.place.latitude!])
            .addTo(map);
        });
    } catch {
      setError(
        'This browser could not start the interactive map. Switch to the list view to read reviews.',
      );
      return;
    }
    return () => map.remove();
  }, [
    resource.style,
    places,
    office?.latitude,
    office?.longitude,
    office?.name,
    colors,
    t,
    number,
  ]);
  return (
    <View style={{ gap: 8 }}>
      <Notice error={resource.error || error} />
      <div
        ref={container}
        data-theme={dark ? 'dark' : 'light'}
        aria-label={
          onPick
            ? t('Choose organization location on map')
            : t('Map of your organization and reviewed lunch spots')
        }
        style={{ width: '100%', height: 360, borderRadius: 18, overflow: 'hidden' }}
      />
    </View>
  );
}
