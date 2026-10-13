import { expect, test } from 'vitest';
import { localDate } from '../src/lib/format';
test('lunch dates use Berlin calendar days at midnight and daylight-saving boundaries', () => {
  expect(localDate(new Date('2026-10-12T22:30:00Z'))).toBe('2026-10-13');
  expect(localDate(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
  expect(localDate(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29');
});
