import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test, vi } from 'vitest';

function worker() {
  const listeners = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const self = {
    location: { origin: 'https://lunch.example.test' },
    addEventListener: (name, listener) => (listeners[name] = listener),
    registration: { showNotification },
    clients: {
      matchAll: async () => [{ url: 'https://lunch.example.test/', navigate, focus }],
      openWindow,
    },
  };
  runInNewContext(readFileSync('public/service-worker.js', 'utf8'), { self, URL });
  return {
    self,
    listeners,
    showNotification,
    openWindow,
    navigate,
    focus,
    dispatch(name, value) {
      let task;
      listeners[name]({ ...value, waitUntil: (promise) => (task = promise) });
      return task;
    },
  };
}

test('push cards replace previous cards and malformed or external links stay inside Forkcast', async () => {
  const sw = worker();
  expect(sw.listeners.fetch).toBeUndefined();
  for (const url of ['https://evil.example.test', 'http://[', '/?pushOrg=test']) {
    await sw.dispatch('push', { data: { json: () => ({ title: 'Lunch', url }) } });
    const [title, options] = sw.showNotification.mock.calls.at(-1);
    expect(title).toBe('Lunch');
    expect(options.tag).toBe('forkcast-lunch-updates');
    expect(options.renotify).toBe(false);
    expect(options.data.url).toBe(
      url.startsWith('/')
        ? 'https://lunch.example.test/?pushOrg=test'
        : 'https://lunch.example.test/',
    );
  }
  await sw.dispatch('push', {
    data: {
      json: () => {
        throw new Error('bad payload');
      },
    },
  });
  expect(sw.showNotification.mock.calls.at(-1)[0]).toBe('Forkcast');
});

test('notification clicks reuse the app window and cannot navigate to another origin', async () => {
  const sw = worker();
  const close = vi.fn();
  await sw.dispatch('notificationclick', {
    notification: { close, data: { url: 'https://evil.example.test/private' } },
  });
  expect(close).toHaveBeenCalledOnce();
  expect(sw.navigate).toHaveBeenCalledWith('https://lunch.example.test/');
  expect(sw.focus).toHaveBeenCalledOnce();
  expect(sw.openWindow).not.toHaveBeenCalled();
  sw.self.clients.matchAll = async () => [];
  await sw.dispatch('notificationclick', {
    notification: { close, data: { url: '/?pushOrg=test' } },
  });
  expect(sw.openWindow).toHaveBeenCalledWith('https://lunch.example.test/?pushOrg=test');
});
