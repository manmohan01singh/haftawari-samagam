/**
 * Persistent playback store (Phase E — the YouTube-style mini
 * player). ONE player lives at the app root (PlaybackHost) and is
 * never unmounted while an item is active; screens come and go
 * underneath it. This store is the whole contract:
 *
 * - `item`    — what is playing (YouTube embed or hosted file).
 * - `mode`    — 'full' (player sits over the Watch page's slot),
 *               'mini' (YouTube: bar + parked embed; hosted: small
 *               floating view), 'closed' (nothing mounted).
 * - `playing` — last known transport state, fed by the players'
 *               own state events (and by bar taps); the mini bar's
 *               icon reads it.
 * - `slotRect`— the Watch page's measured player slot (window
 *               coordinates + the item key it belongs to). The host
 *               positions the single player exactly over it in full
 *               mode; a stale rect for another item is ignored.
 * - `routeName` — current route, fed by App's NavigationContainer
 *               state changes; the host hides the mini bar on the
 *               session/admin surfaces (design: sessions are the
 *               live event itself and stay self-contained).
 *
 * Session watches (Watch route WITH a sessionId, and SessionWatch)
 * deliberately do NOT use this store: presence, chat and group sync
 * belong to their screen, so they keep their in-screen player.
 */
import { create } from 'zustand';

export interface PlaybackItem {
  /** Stable identity of the playing video (player key). */
  key: string;
  kind: 'youtube' | 'hosted';
  youtubeVideoId: string | null;
  videoRowId: string | null;
  title: string;
  channelLine: string;
  thumbnailUrl: string | null;
}

export interface SlotRect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PlaybackMode = 'closed' | 'full' | 'mini';

interface PlaybackState {
  item: PlaybackItem | null;
  mode: PlaybackMode;
  playing: boolean;
  slotRect: SlotRect | null;
  routeName: string | null;
  /**
   * Which flavour of Watch screen is focused: 'plain' (the
   * persistent player's own screen) or 'session' (a session watch,
   * which has its own in-screen player). A session Watch sits at
   * the same screen position as a plain one, so without this flag
   * the host could draw the persistent player over the session's
   * own player when a session watch is pushed over a plain watch.
   */
  watchKind: 'plain' | 'session';
  /**
   * The item key the host is actually rendering visibly right now
   * (set by PlaybackHost when its player is on screen in the Watch
   * slot). The Watch screen watches this: if its hand-off is not
   * covered within a few seconds it mounts a rescue player in its
   * own slot rather than leaving a dead poster.
   */
  coveredKey: string | null;
  setCoveredKey: (key: string | null) => void;
  /**
   * The item key whose playback the Watch screen's rescue player
   * has taken over: the host must neither mount its own player for
   * it nor park-pause it while the rescue player is on screen.
   */
  suppressedKey: string | null;
  setSuppressedKey: (key: string | null) => void;
  open: (item: PlaybackItem) => void;
  minimize: () => void;
  expand: () => void;
  close: () => void;
  setPlaying: (playing: boolean) => void;
  setSlotRect: (rect: SlotRect | null) => void;
  setRouteName: (name: string | null) => void;
  setWatchKind: (kind: 'plain' | 'session') => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  item: null,
  mode: 'closed',
  playing: false,
  slotRect: null,
  routeName: null,
  watchKind: 'plain',
  coveredKey: null,
  setCoveredKey: (coveredKey) => set({ coveredKey }),
  suppressedKey: null,
  setSuppressedKey: (suppressedKey) => set({ suppressedKey }),
  open: (item) =>
    set((s) => {
      const same = s.item?.key === item.key && s.mode !== 'closed';
      return {
        item,
        mode: 'full',
        watchKind: 'plain' as const,
        // A genuinely new item starts from the players' own
        // behaviour (hosted autoplays; the YouTube embed waits for
        // its own tap / API state) — `playing` is corrected by the
        // players' state events as soon as they report.
        playing: same ? s.playing : false,
        slotRect: same ? s.slotRect : null,
        coveredKey: same ? s.coveredKey : null,
      };
    }),
  minimize: () => set((s) => (s.item ? { mode: 'mini' } : s)),
  expand: () => set((s) => (s.item ? { mode: 'full' } : s)),
  close: () =>
    set({ item: null, mode: 'closed', playing: false, slotRect: null, coveredKey: null, suppressedKey: null }),
  setPlaying: (playing) => set({ playing }),
  setSlotRect: (slotRect) => set({ slotRect }),
  setRouteName: (routeName) => set({ routeName }),
  setWatchKind: (watchKind) => set({ watchKind }),
}));
