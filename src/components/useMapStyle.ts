import { publicConfig } from '../lib/config';
import { useEffect, useState } from 'react';
import type { StyleSpecification } from 'maplibre-gl';
import { message } from '../lib/supabase';
import { useTheme } from '../providers/Theme';
export function useMapStyle() {
  const { dark } = useTheme();
  const url = dark ? publicConfig.darkMapStyleUrl : publicConfig.mapStyleUrl;
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setStyle(null);
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error('Map tiles are unavailable. Switch to the list view to read reviews.');
        return response.json();
      })
      .then((data: StyleSpecification) => {
        if (data.version !== 8 || !Array.isArray(data.layers))
          throw new Error('The map style could not be loaded.');
        // Hide arbitrary basemap POIs; the app adds the office and reviewed restaurant markers.
        setStyle({
          ...data,
          layers: data.layers.filter(
            (layer) =>
              !('source-layer' in layer && /^poi(?:_|$)/i.test(layer['source-layer'] ?? '')),
          ),
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      });
    return () => controller.abort();
  }, [url]);
  return { style, error };
}
