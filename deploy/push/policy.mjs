export const categories = ['cooking', 'deadlines', 'arrivals', 'replies', 'payments', 'organizer'];
export function localClock(now, timezone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now);
  } catch {
    timezone = 'Europe/Berlin';
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
export function quietNow(preferences, now) {
  const { hour } = localClock(now, preferences.timezone);
  const start = preferences.quiet_start,
    end = preferences.quiet_end;
  return start !== end && (start < end ? hour >= start && hour < end : hour >= start || hour < end);
}
export function deliveryAllowed(preferences, events, now) {
  if (!preferences.enabled || quietNow(preferences, now)) return false;
  const { day } = localClock(now, preferences.timezone);
  if (
    preferences.budget_day === day &&
    preferences.sent_today >= Math.min(3, preferences.daily_limit)
  )
    return false;
  // Food arrival can bypass spacing, never the daily limit or quiet hours.
  return (
    events.some((event) => event.category === 'arrivals') ||
    !preferences.last_sent_at ||
    now - new Date(preferences.last_sent_at) >= 30 * 60000
  );
}
export function allowedEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (['fcm.googleapis.com', 'web.push.apple.com'].includes(url.hostname) ||
        /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}
export function pushMessage(events, locale, origin) {
  const german = locale === 'de';
  const first = events[0];
  const labels = {
    cooking: german ? 'Neue gemeinsame Essenspläne' : 'New lunch plans',
    deadlines: german ? 'Anmeldung endet bald' : 'Signup closes soon',
    arrivals: german ? 'Das Essen ist da' : 'Your food has arrived',
    replies: german ? 'Neue Antwort beim gemeinsamen Kochen' : 'New cooking discussion reply',
    payments: german ? 'Noch offene Essenszahlungen' : 'Outstanding lunch payments',
    organizer: german ? 'Neuigkeiten zu deinem Essen' : 'Updates for your lunch',
  };
  const singleTarget = events.every(
    (event) =>
      event.organization_id === first.organization_id &&
      event.event_id === first.event_id &&
      event.order_id === first.order_id,
  );
  const url = new URL('/', origin);
  if (singleTarget) {
    url.searchParams.set('pushOrg', first.organization_id);
    if (first.event_id) url.searchParams.set('pushEvent', first.event_id);
    if (first.order_id) url.searchParams.set('pushOrder', first.order_id);
  }
  return {
    title:
      events.length === 1
        ? labels[first.category]
        : german
          ? 'Neuigkeiten zum Mittagessen'
          : 'Lunch updates',
    body:
      events.length === 1
        ? german
          ? 'Öffne Forkcast für die Details.'
          : 'Open Forkcast for the details.'
        : german
          ? `${events.length} neue Hinweise. Öffne Forkcast für die Details.`
          : `${events.length} updates. Open Forkcast for the details.`,
    url: url.href,
    tag: 'forkcast-lunch-updates',
  };
}
