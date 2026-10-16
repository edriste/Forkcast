/* Push only: never cache authentication, API responses or runtime configuration. */
function localUrl(value) {
  try {
    const url = new URL(value || '/', self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch { /* fall back to the app */ }
  return self.location.origin + '/';
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { /* show a safe generic notification */ }
    const safeUrl = localUrl(payload.url);
    await self.registration.showNotification(payload.title || 'Forkcast', {
      body: payload.body || 'Open Forkcast for the details.',
      icon: '/push-icon.png', badge: '/push-icon.png', tag: 'forkcast-lunch-updates',
      renotify: false, data: { url: safeUrl },
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = localUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); await existing.focus(); }
    else await self.clients.openWindow(url);
  })());
});
