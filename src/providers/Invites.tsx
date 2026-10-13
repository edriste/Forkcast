import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { inviteCode } from '../lib/invites';
import AsyncStorage from '@react-native-async-storage/async-storage';
const storageKey = 'forkcast.pending-invite';
export async function persistInvite(value: string) {
  if (value) await AsyncStorage.setItem(storageKey, value);
  else await AsyncStorage.removeItem(storageKey);
}
const Context = createContext<{ pendingInvite: string; setPendingInvite: (value: string) => void }>(
  null!,
);
export function useInvites() {
  return useContext(Context);
}
// Mounted above authentication so a link received while signed out survives login.
export function InviteProvider({ children }: React.PropsWithChildren) {
  const [pendingInvite, updatePendingInvite] = useState('');
  const setPendingInvite = (value: string) => {
    updatePendingInvite(value);
    void persistInvite(value).catch(() => {
      /* Can still paste an invite manually. */
    });
  };
  useEffect(() => {
    let active = true;
    let received = false;
    const receive = (url: string) => {
      const code = inviteCode(url);
      if (active && code) {
        received = true;
        setPendingInvite(code);
      }
    };
    Promise.all([Linking.getInitialURL(), AsyncStorage.getItem(storageKey)])
      .then(([url, saved]) => {
        if (!active) return;
        if (!received) {
          if (saved) updatePendingInvite(inviteCode(saved));
          if (url) receive(url);
        }
      })
      .catch(() => {
        /* A code can still be pasted manually. */
      });
    const subscription = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return (
    <Context.Provider value={{ pendingInvite, setPendingInvite }}>{children}</Context.Provider>
  );
}
