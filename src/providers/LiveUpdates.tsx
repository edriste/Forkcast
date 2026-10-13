import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { localDate } from '../lib/format';
import { useOrganizations } from './Organizations';
import { useSession } from './Auth';
export type LiveTopic =
  'organization' | 'places' | 'cooking' | 'lunch' | 'images' | 'inbox' | 'orders';
type Listener = { topics: string[]; notify: () => void };
const Context = createContext<{
  subscribe: (topics: string[], notify: () => void) => () => void;
} | null>(null);
export function LiveUpdatesProvider({ children }: React.PropsWithChildren) {
  const { current, reload: reloadOrganizations } = useOrganizations();
  const user = useSession().user.id;
  const org = current!.id;
  const listeners = useRef(new Set<Listener>());
  const pending = useRef(new Set<string>());
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(false);
  const subscribe = useCallback((topics: string[], notify: () => void) => {
    const listener = { topics, notify };
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const emit = useCallback((topic: string) => {
    if (AppState.currentState !== 'active') return;
    pending.current.add(topic);
    if (debounce.current) return;
    debounce.current = setTimeout(() => {
      debounce.current = undefined;
      if (AppState.currentState !== 'active') {
        pending.current.clear();
        return;
      }
      const topics = new Set(pending.current);
      pending.current.clear();
      for (const listener of listeners.current)
        if (topics.has('*') || listener.topics.some((topic) => topics.has(topic)))
          listener.notify();
    }, 350);
  }, []);
  useEffect(
    () =>
      subscribe(['organization'], () => {
        void reloadOrganizations();
      }),
    [subscribe, reloadOrganizations],
  );
  useEffect(() => {
    let alive = true;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let connection = 0;
    const connect = () => {
      if (channel || !alive) return;
      const next = supabase.channel(`forkcast-live:${org}:${user}:${++connection}`);
      channel = next;
      for (const event of ['INSERT', 'UPDATE'] as const) {
        next.on(
          'postgres_changes',
          {
            event,
            schema: 'public',
            table: 'organization_signals',
            filter: `organization_id=eq.${org}`,
          },
          (payload) => {
            const record = payload.new as Record<string, unknown>;
            if (
              alive &&
              channel === next &&
              record.organization_id === org &&
              typeof record.topic === 'string'
            )
              emit(record.topic);
          },
        );
        next.on(
          'postgres_changes',
          {
            event,
            schema: 'public',
            table: 'membership_signals',
            filter: `user_id=eq.${user}`,
          },
          (payload) => {
            if (
              alive &&
              channel === next &&
              (payload.new as Record<string, unknown>).user_id === user
            )
              emit('organization');
          },
        );
        next.on(
          'postgres_changes',
          { event, schema: 'public', table: 'inbox_signals', filter: `recipient_id=eq.${user}` },
          (payload) => {
            const record = payload.new as Record<string, unknown>;
            if (
              alive &&
              channel === next &&
              record.organization_id === org &&
              record.recipient_id === user
            )
              emit('inbox');
          },
        );
      }
      next.subscribe((status) => {
        if (!alive || channel !== next) return;
        live.current = status === 'SUBSCRIBED';
        if (live.current) emit('*');
      });
    };
    const disconnect = () => {
      const previous = channel;
      channel = null;
      live.current = false;
      if (previous) void supabase.removeChannel(previous);
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') connect();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        connect();
        emit('*');
      } else disconnect();
    });
    const online = () => emit('*');
    if (Platform.OS === 'web') window.addEventListener('online', online);
    let day = localDate();
    let minutes = 0;
    const fallback = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      minutes++;
      const next = localDate();
      if (!live.current || minutes % 5 === 0 || next !== day) emit('*');
      day = next;
    }, 60000);
    return () => {
      alive = false;
      live.current = false;
      disconnect();
      foreground.remove();
      clearInterval(fallback);
      if (Platform.OS === 'web') window.removeEventListener('online', online);
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = undefined;
      pending.current.clear();
    };
  }, [org, user, emit]);
  return <Context.Provider value={{ subscribe }}>{children}</Context.Provider>;
}
export function useAutomaticRefresh(refresh: () => void, topics: LiveTopic[], enabled = true) {
  const updates = useContext(Context);
  const latest = useRef(refresh);
  latest.current = refresh;
  const key = topics.join(',');
  useEffect(() => {
    if (!updates || !enabled) return;
    return updates.subscribe(key.split(','), () => latest.current());
  }, [updates?.subscribe, key, enabled]);
}
