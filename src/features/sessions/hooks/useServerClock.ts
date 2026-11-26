import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { serverClock } from '../serverClock';

/**
 * Ticking server time for session screens.
 *
 * - Syncs the server offset on mount, every 60s, and whenever the app
 *   returns to the foreground (the "reconnect re-syncs" path).
 * - Ticks once per second so derived status / offsets / countdowns stay
 *   current without any per-second network traffic.
 */
export function useServerClock(tickMs = 1000): { nowMs: number; synced: boolean } {
  const [nowMs, setNowMs] = useState(() => serverClock.nowMs());
  const [synced, setSynced] = useState(serverClock.isSynced);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const doSync = () => {
      void serverClock.sync().then(() => {
        if (mounted.current) {
          setSynced(serverClock.isSynced);
          setNowMs(serverClock.nowMs());
        }
      });
    };
    doSync();
    const resync = setInterval(doSync, 60_000);
    const tick = setInterval(() => {
      if (mounted.current) setNowMs(serverClock.nowMs());
    }, tickMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') doSync();
    });
    return () => {
      mounted.current = false;
      clearInterval(resync);
      clearInterval(tick);
      sub.remove();
    };
  }, [tickMs]);

  return { nowMs, synced };
}
