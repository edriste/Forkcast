import type { PushSettings } from './pushTypes';
export function pushSupported() {
  return false;
}
export async function currentPushEndpoint(): Promise<string | null> {
  return null;
}
export async function enableDevicePush(_locale: string): Promise<void> {
  throw new Error('Device push is available in a supported browser or Home Screen web app.');
}
export async function disableDevicePush(): Promise<void> {}
export async function unsubscribeBrowserPush(): Promise<void> {}
export async function loadPushSettings(): Promise<PushSettings> {
  throw new Error('Device push is available in a supported browser or Home Screen web app.');
}
