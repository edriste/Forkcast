import { useLocale } from '../providers/Locale';
import { useEffect } from 'react';
import { publicConfig } from '../lib/config';
import { currentPushEndpoint } from '../lib/push';
import { supabase } from '../lib/supabase';
export function PushActivity() {
  const { language } = useLocale();
  useEffect(() => {
    if (!publicConfig.webPushKey) return;
    let active = true;
    const touch = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const endpoint = await currentPushEndpoint();
        if (active && endpoint)
          await supabase.rpc('touch_web_push', {
            device_endpoint: endpoint,
            language,
            zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
      } catch {
        /* best effort presence */
      }
    };
    void touch();
    const interval = setInterval(() => void touch(), 60000);
    document.addEventListener('visibilitychange', touch);
    window.addEventListener('forkcast-push-changed', touch);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', touch);
      window.removeEventListener('forkcast-push-changed', touch);
    };
  }, [language]);
  return null;
}
