import { getServerNow } from './sessionService';

/**
 * Server-synced clock.
 *
 * Every participant must derive the same session status and playback
 * offset, so device clocks are never trusted directly: the offset
 * between the Supabase server's clock (read from an HTTP Date header)
 * and the local clock is measured once, then applied to every local
 * reading. Re-sync on app foreground / reconnect keeps the offset
 * honest over a long session.
 */
export class ServerClock {
  private offsetMs = 0;
  private syncedFlag = false;
  private syncing: Promise<void> | null = null;

  /** Measure (or re-measure) the server↔local offset. Safe to call often. */
  async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      try {
        // Burst sampling (audit P2, 28 Nov 2026; the live-sync deep
        // research recommended exactly this): a single sample lets
        // one slow round trip skew every viewer's session offset.
        // Take 5 samples and keep the LOWEST-RTT one — its midpoint
        // estimate carries the least network error. (The Date header
        // itself has 1 s resolution; this removes the network part
        // of the error, which is the part that differs per viewer.)
        let best: { offset: number; rtt: number } | null = null;
        for (let i = 0; i < 5; i++) {
          const before = Date.now();
          const serverMs = await getServerNow();
          const after = Date.now();
          const rtt = after - before;
          // Assume the server timestamp corresponds to the midpoint
          // of the round trip — halves the network-latency error.
          const localMid = before + rtt / 2;
          const offset = serverMs - localMid;
          if (!best || rtt < best.rtt) best = { offset, rtt };
        }
        if (best) {
          this.offsetMs = best.offset;
          this.syncedFlag = true;
        }
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  /** Current time on the server clock (ms since epoch). */
  nowMs(): number {
    return Date.now() + this.offsetMs;
  }

  get isSynced(): boolean {
    return this.syncedFlag;
  }

  get offsetMilliseconds(): number {
    return this.offsetMs;
  }
}

/** Shared instance — one clock for the whole app. */
export const serverClock = new ServerClock();
