import { localDate } from './format';

const berlinClock = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function deadlineFields(timestamp: string) {
  const parts = berlinClock.formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

export function parseBerlinDeadline(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error('Choose a valid signup date (YYYY-MM-DD) and time (HH:mm).');
  const wallTime = Date.parse(`${date}T${time}:00Z`);
  const matches = [1, 2]
    .map((offset) => new Date(wallTime - offset * 3600000))
    .filter((candidate) => {
      if (Number.isNaN(candidate.getTime())) return false;
      const fields = deadlineFields(candidate.toISOString());
      return fields.date === date && fields.time === time;
    });
  if (!matches.length)
    throw new Error('This date and time does not exist in Berlin. Choose another time.');
  if (matches.length > 1)
    throw new Error('This time occurs twice in Berlin. Choose a time outside the clock change.');
  return matches[0].toISOString();
}

export function displayDeadline(timestamp: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Berlin',
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

export function signupClosed(
  event: { meal_date: string; signup_deadline?: string | null },
  now = Date.now(),
) {
  return (
    event.meal_date < localDate(new Date(now)) ||
    (!!event.signup_deadline && new Date(event.signup_deadline).getTime() <= now)
  );
}

export function nextSignupClockChange(
  deadlines: readonly (string | null | undefined)[],
  now: number,
) {
  const date = localDate(new Date(now));
  const tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const midnight = Date.parse(parseBerlinDeadline(tomorrow, '00:00'));
  return Math.min(
    midnight,
    ...deadlines.map((value) => (value ? Date.parse(value) : NaN)).filter((time) => time > now),
  );
}
