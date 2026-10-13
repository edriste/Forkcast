import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { nextSignupClockChange } from './signupDeadline';

// Deadline expiry needs no server write or polling; foregrounding corrects suspended timers.
export function useSignupClock(deadlines: readonly (string | null | undefined)[]) {
  const key = deadlines.filter(Boolean).sort().join('|');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      timer = setTimeout(
        tick,
        Math.min(2147483647, nextSignupClockChange(key.split('|'), current) - current + 25),
      );
    };
    tick();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [key]);
  return now;
}
