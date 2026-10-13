import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSession } from './Auth';
import { message, supabase } from '../lib/supabase';
import { useInvites } from './Invites';
import type { Organization } from '../lib/types';
type OrgContext = {
  organizations: Organization[];
  current: Organization | null;
  loading: boolean;
  error: string;
  pendingInvite: string;
  setPendingInvite: (value: string) => void;
  reload: (selectId?: string) => Promise<void>;
  select: (id: string) => void;
};
const Context = createContext<OrgContext>(null!);
export function useOrganizations() {
  return useContext(Context);
}
export function OrganizationProvider({ children }: React.PropsWithChildren) {
  const session = useSession();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [id, setId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { pendingInvite, setPendingInvite } = useInvites();
  const active = useRef(true);
  const selected = useRef('');
  const generation = useRef(0);
  const storageKey = `forkcast:org:${session.user.id}`;
  const reload = useCallback(
    async (selectId?: string) => {
      const request = ++generation.current;
      setError('');
      try {
        const { data, error } = await supabase.from('organizations').select('*').order('name');
        if (error) throw error;
        const stored = selectId ?? (selected.current || (await AsyncStorage.getItem(storageKey)));
        if (!active.current || generation.current !== request) return;
        setOrganizations(data);
        const next = data.find((org) => org.id === stored)?.id ?? data[0]?.id ?? '';
        selected.current = next;
        setId(next);
      } catch (e) {
        if (active.current && generation.current === request) setError(message(e));
      } finally {
        if (active.current && generation.current === request) setLoading(false);
      }
    },
    [storageKey],
  );
  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
    };
  }, [reload]);
  useEffect(() => {
    const refresh = () => {
      if (!selected.current) void reload();
    };
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    if (Platform.OS === 'web') window.addEventListener('online', refresh);
    return () => {
      foreground.remove();
      if (Platform.OS === 'web') window.removeEventListener('online', refresh);
    };
  }, [reload]);
  useEffect(() => {
    if (id) AsyncStorage.setItem(storageKey, id).catch((e) => setError(message(e)));
  }, [id, storageKey]);
  return (
    <Context.Provider
      value={{
        organizations,
        current: organizations.find((org) => org.id === id) ?? null,
        loading,
        error,
        pendingInvite,
        setPendingInvite,
        reload,
        select: (value) => {
          generation.current++;
          selected.current = value;
          setId(value);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
