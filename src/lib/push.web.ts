import { publicConfig } from './config';
import { supabase } from './supabase';
import type { PushSettings } from './pushTypes';
export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}
export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  return (
    (await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())
      ?.endpoint ?? null
  );
}
export async function enableDevicePush(locale: string): Promise<void> {
  if (!pushSupported())
    throw new Error('Device push is available in a supported browser or Home Screen web app.');
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error(
      'Notifications are blocked. Allow them in your browser settings to enable device alerts.',
    );
  await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  const registration = await navigator.serviceWorker.ready;
  const previous = await registration.pushManager.getSubscription();
  // A new subscription avoids reusing a capability belonging to an earlier account/key.
  if (previous) await previous.unsubscribe();
  const raw = atob(publicConfig.webPushKey.replace(/-/g, '+').replace(/_/g, '/'));
  const key = Uint8Array.from(raw, (value) => value.charCodeAt(0));
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  try {
    const json = subscription.toJSON();
    const { error } = await supabase.rpc('register_web_push', {
      device_endpoint: subscription.endpoint,
      device_key: json.keys?.p256dh,
      device_auth: json.keys?.auth,
      language: locale === 'de' ? 'de' : 'en',
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
    });
    if (error) throw error;
  } catch (error) {
    await subscription.unsubscribe();
    throw error;
  }
  window.dispatchEvent(new Event('forkcast-push-changed'));
}
export async function disableDevicePush(): Promise<void> {
  const endpoint = await currentPushEndpoint();
  // Stop browser delivery first, even if server cleanup fails while offline.
  await unsubscribeBrowserPush();
  if (endpoint) {
    const { error } = await supabase.rpc('unregister_web_push', { device_endpoint: endpoint });
    if (error) throw error;
  }
  window.dispatchEvent(new Event('forkcast-push-changed'));
}
export async function unsubscribeBrowserPush(): Promise<void> {
  if (!pushSupported()) return;
  const subscription = await (
    await navigator.serviceWorker.getRegistration('/')
  )?.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
}
export async function loadPushSettings(): Promise<PushSettings> {
  const { data, error } = await supabase.rpc('web_push_settings');
  if (error) throw error;
  return data;
}
