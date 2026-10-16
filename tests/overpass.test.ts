import { expect, test } from 'vitest';
import { restaurantQuery } from '../supabase/functions/_shared/overpass';
import { OSM_RADIUS_METERS } from '../supabase/functions/_shared/osm';

test('indexed restaurant bounding boxes enclose the full radius at different latitudes', () => {
  const radians = Math.PI / 180;
  const angle = OSM_RADIUS_METERS / 6371000;
  for (const latitude of [-80, -50, 0, 50.936, 80]) {
    const longitude = 6.939;
    const query = restaurantQuery(latitude, longitude);
    const [south, west, north, east] = query
      .match(/\[bbox:([^\]]+)\]/)![1]
      .split(',')
      .map(Number);
    // Independently construct points on the circle's edge in every direction.
    for (let bearing = 0; bearing < 360; bearing++) {
      const lat = latitude * radians;
      const heading = bearing * radians;
      const destinationLat = Math.asin(
        Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(heading),
      );
      const destinationLon =
        longitude +
        Math.atan2(
          Math.sin(heading) * Math.sin(angle) * Math.cos(lat),
          Math.cos(angle) - Math.sin(lat) * Math.sin(destinationLat),
        ) /
          radians;
      expect(destinationLat / radians).toBeGreaterThanOrEqual(south);
      expect(destinationLat / radians).toBeLessThanOrEqual(north);
      expect(destinationLon).toBeGreaterThanOrEqual(west);
      expect(destinationLon).toBeLessThanOrEqual(east);
    }
    expect(query).toContain(`(around:3000,${latitude},${longitude})`);
  }
});

test('restaurant radius searches remain valid near the poles and date line', () => {
  for (const [latitude, longitude] of [
    [89.99, 0],
    [-89.99, 0],
    [0, 179.99],
    [0, -179.99],
  ]) {
    const query = restaurantQuery(latitude, longitude);
    expect(query).not.toContain('[bbox:');
    expect(query).toContain(`(around:3000,${latitude},${longitude})`);
    expect(query).not.toMatch(/NaN|Infinity/);
  }
});
