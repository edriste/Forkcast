import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSession } from './Auth';
import { useOrganizations } from './Organizations';
import { useAutomaticRefresh } from './LiveUpdates';
import { message, supabase } from '../lib/supabase';

const Context = createContext<{
  ids: string[];
  loading: boolean;
  busy: boolean;
  error: string;
  reload: () => Promise<void>;
  setFavorite: (id: string, bookmarked: boolean) => Promise<void>;
} | null>(null);
export function useFavorites() {
  return useContext(Context)!;
}

export function FavoritesProvider({ children }: React.PropsWithChildren) {
  const org = useOrganizations().current!.id;
  const user = useSession().user.id;
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const active = useRef(true);
  const mutating = useRef(false);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next: string[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await supabase
          .from('restaurant_favorites')
          .select('place_id')
          .eq('organization_id', org)
          .eq('user_id', user)
          .order('place_id')
          .range(offset, offset + 499);
        if (result.error) throw result.error;
        next.push(...result.data.map((row) => row.place_id));
        if (result.data.length < 500) break;
      }
      if (active.current && request === generation.current) {
        setIds((old) => (old.join('|') === next.join('|') ? old : next));
        setError('');
      }
    } catch (e) {
      if (active.current && request === generation.current) setError(message(e));
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [org, user]);
  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
      generation.current++;
    };
  }, [reload]);
  useAutomaticRefresh(() => {
    void reload();
  }, ['inbox', 'organization']);
  async function setFavorite(id: string, bookmarked: boolean) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await supabase.rpc('set_restaurant_favorite', {
        org,
        osm_place_id: id,
        bookmarked,
      });
      if (result.error) throw result.error;
      await reload();
    } catch (e) {
      if (active.current) setError(message(e));
    } finally {
      mutating.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Context.Provider value={{ ids, loading, busy, error, reload, setFavorite }}>
      {children}
    </Context.Provider>
  );
}
