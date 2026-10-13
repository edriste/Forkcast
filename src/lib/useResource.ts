import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useAutomaticRefresh, type LiveTopic } from '../providers/LiveUpdates';
import { message } from './supabase';
export function useResource<T>(load: () => Promise<T>, topics: LiveTopic[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const active = useRef(true);
  const loader = useRef(load);
  loader.current = load;
  const previous = useRef(load);
  const running = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const reload = useCallback(async () => {
    if (!active.current) return;
    if (running.current) {
      queued.current = true;
      await running.current;
      return;
    }
    const request = ++generation.current;
    setLoading(true);
    setError('');
    const task = (async () => {
      try {
        const next = await loader.current();
        if (active.current && generation.current === request) setData(next);
      } catch (e) {
        if (active.current && generation.current === request) setError(message(e));
      } finally {
        if (active.current && generation.current === request) setLoading(false);
      }
    })();
    running.current = task;
    await task;
    if (running.current === task) running.current = null;
    if (queued.current && active.current) {
      queued.current = false;
      void reload();
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      if (previous.current !== load) {
        previous.current = load;
        setData(null);
      }
      void reload();
      return () => {
        active.current = false;
        generation.current++;
        queued.current = false;
      };
    }, [load, reload]),
  );
  useAutomaticRefresh(
    () => {
      void reload();
    },
    topics,
    useIsFocused(),
  );
  return { data, loading, error, reload };
}
