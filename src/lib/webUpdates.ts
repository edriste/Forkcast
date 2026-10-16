export function parseRelease(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('version' in value)) return null;
  return typeof value.version === 'string' && /^[a-f0-9]{64}$/.test(value.version)
    ? value.version
    : null;
}

// The checker runs only for prepared production exports. Failures leave the
// current app alone; neither a failed request nor malformed SPA HTML is an update.
export function watchWebUpdates(current: string, report: (version: string | null) => void) {
  let stopped = false;
  let pending = false;
  let lastCheck = -Infinity;
  let controller: AbortController | undefined;
  const check = async () => {
    if (stopped || pending || document.visibilityState !== 'visible' || navigator.onLine === false)
      return;
    if (Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    pending = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 10_000);
    try {
      const response = await fetch('/version.json', {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) return;
      const release = parseRelease(await response.json());
      if (!stopped && release) report(release === current ? null : release);
    } catch {
      // Offline and unavailable deployments should never interrupt a session.
    } finally {
      clearTimeout(timeout);
      pending = false;
    }
  };
  void check();
  const interval = setInterval(() => void check(), 5 * 60_000);
  const foreground = () => void check();
  const online = () => {
    lastCheck = -Infinity;
    void check();
  };
  document.addEventListener('visibilitychange', foreground);
  window.addEventListener('focus', foreground);
  window.addEventListener('online', online);
  return () => {
    stopped = true;
    controller?.abort();
    clearInterval(interval);
    document.removeEventListener('visibilitychange', foreground);
    window.removeEventListener('focus', foreground);
    window.removeEventListener('online', online);
  };
}
