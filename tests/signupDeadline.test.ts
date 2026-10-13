import { expect, test } from 'vitest';
import {
  deadlineFields,
  displayDeadline,
  nextSignupClockChange,
  parseBerlinDeadline,
  signupClosed,
} from '../src/lib/signupDeadline';

test('signup times convert Berlin summer and winter clocks to absolute timestamps', () => {
  expect(parseBerlinDeadline('2026-10-13', '11:00')).toBe('2026-10-13T09:00:00.000Z');
  expect(parseBerlinDeadline('2026-01-13', '11:00')).toBe('2026-01-13T10:00:00.000Z');
  expect(deadlineFields('2026-10-13T09:00:00Z')).toEqual({ date: '2026-10-13', time: '11:00' });
  expect(displayDeadline('2026-10-13T09:00:00Z', 'de-DE')).toContain('11:00');
});

test('invalid dates and nonexistent or ambiguous Berlin clock-change times are rejected', () => {
  expect(() => parseBerlinDeadline('2026-02-30', '11:00')).toThrow('does not exist');
  expect(() => parseBerlinDeadline('2026-10-13', '24:00')).toThrow('valid signup');
  expect(() => parseBerlinDeadline('2026-03-29', '02:30')).toThrow('does not exist');
  expect(() => parseBerlinDeadline('2026-10-25', '02:30')).toThrow('occurs twice');
  expect(parseBerlinDeadline('2026-10-25', '03:00')).toBe('2026-10-25T02:00:00.000Z');
});

test('signup closes at the exact deadline and old events without deadlines keep normal behavior', () => {
  const deadline = '2026-10-13T09:00:00Z';
  const event = { meal_date: '2026-10-13', signup_deadline: deadline };
  expect(signupClosed(event, Date.parse(deadline) - 1)).toBe(false);
  expect(signupClosed(event, Date.parse(deadline))).toBe(true);
  expect(signupClosed({ meal_date: '2026-10-13' }, Date.parse(deadline))).toBe(false);
  expect(signupClosed({ meal_date: '2026-10-12' }, Date.parse(deadline))).toBe(true);
});

test('expiry scheduling uses the nearest deadline and Berlin midnight across daylight saving', () => {
  const now = Date.parse('2026-03-29T00:00:00Z');
  expect(nextSignupClockChange([], now)).toBe(Date.parse('2026-03-29T22:00:00Z'));
  expect(
    nextSignupClockChange(
      [null, '2026-03-28T12:00:00Z', '2026-03-29T11:00:00Z', '2026-03-29T09:00:00Z'],
      now,
    ),
  ).toBe(Date.parse('2026-03-29T09:00:00Z'));
});
