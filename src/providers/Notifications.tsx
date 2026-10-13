import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAutomaticRefresh } from './LiveUpdates';
import { useOrganizations } from './Organizations';
import { message, supabase } from '../lib/supabase';

export type LunchNotification = {
  id: string;
  event_id: string;
  kind:
    | 'cooking_scheduled'
    | 'payment_due'
    | 'payment_received'
    | 'payment_confirmed'
    | 'cooking_joined';
  title: string | null;
  meal_date: string;
  signup_deadline?: string | null;
  actor_name: string;
  price_cents: number;
  portions: number | null;
  read_at: string | null;
};
type Inbox = { unread: number; items: LunchNotification[] };
type Notifications = Inbox & {
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  update: (id: string, dismiss?: boolean) => Promise<void>;
  readAll: () => Promise<void>;
  join: (id: string) => Promise<void>;
};
const Context = createContext<Notifications | null>(null);
export function useNotifications() {
  return useContext(Context)!;
}
export function NotificationsProvider({ children }: React.PropsWithChildren) {
  const org = useOrganizations().current!.id;
  const [inbox, setInbox] = useState<Inbox>({ unread: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const { data, error } = await supabase.rpc('notification_inbox', { org });
      if (error) throw error;
      if (request === generation.current) {
        setInbox(data);
        setError('');
      }
    } catch (e) {
      if (request === generation.current) setError(message(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [org]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  useAutomaticRefresh(() => {
    void refresh();
  }, ['inbox', 'cooking', 'organization']);
  const mutate = async (rpc: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(rpc, { org, ...args });
    await refresh();
    if (error) throw error;
  };
  return (
    <Context.Provider
      value={{
        ...inbox,
        loading,
        error,
        refresh,
        update: (id, dismiss = false) => mutate('update_notification', { notice: id, dismiss }),
        readAll: () => mutate('read_all_notifications', {}),
        join: (id) => mutate('join_notification_lunch', { notice: id }),
      }}
    >
      {children}
    </Context.Provider>
  );
}
