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
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Dock persistence (fix round 6, R5-7): a full page load used to
 * silently delete the docked video — the store is memory-only, so
 * arriving by URL (or any reload) vapourised it. The docked item
 * (and its last position, written by the host every few seconds)
 * now persists; on boot the dock is restored PAUSED at that
 * position — the hand-back rule in PlaybackHost (a mount with a
 * rescuePosition inherits `playing`) keeps it from auto-starting,
 * and its onReady seeks to the saved spot. Close clears it.
 */
const DOCK_STORE_KEY = 'haftawari.dock.v1';

interface PersistedDock {
  item: PlaybackItem;
  seconds: number | null;
}

function readPersistedDockSync(): PersistedDock | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = window.localStorage.getItem(DOCK_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDock;
    if (!parsed.item?.key || parsed.item.kind !== 'youtube' || !parsed.item.youtubeVideoId) return null;
    return parsed;
  } catch {
    return null;
  }
}

// The last position this module wrote (fix round 6.1, #12):
// minimize() used to persist seconds:null in a separate async
// write that could land AFTER a position write and wipe it — the
// restored dock then had no hand-back and autoplay restarted it
// from 0, playing. One module-level value is now the single
// source every persist carries.
let lastDockSeconds: number | null = null;

function persistDock(item: PlaybackItem | null, seconds?: number | null): void {
  if (item === null) {
    lastDockSeconds = null;
    AsyncStorage.removeItem(DOCK_STORE_KEY).catch(() => undefined);
    return;
  }
  if (typeof seconds === 'number') lastDockSeconds = seconds;
  AsyncStorage.setItem(
    DOCK_STORE_KEY,
    JSON.stringify({ item, seconds: lastDockSeconds }),
  ).catch(() => undefined);
}

/** The host calls this while the dock plays, so a reload restores
 *  roughly where the listener left off (not from 0). */
export function persistDockPosition(seconds: number): void {
  const raw = readPersistedDockSync();
  if (!raw) return;
  persistDock(raw.item, Math.floor(seconds));
}

const restoredDock = readPersistedDockSync();
if (restoredDock?.seconds != null) lastDockSeconds = restoredDock.seconds;

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
  /**
   * Rescue hand-back position: when the Watch screen's rescue
   * player unmounts, it leaves the position it had reached here;
   * the host's fresh player for the same item seeks to it on
   * ready instead of restarting the recording from 0 (the mini
   * discontinuity Chat 2's runs exposed — a fresh instance also
   * jumps a live stream to the live edge).
   */
  rescuePosition: { key: string; seconds: number } | null;
  setRescuePosition: (position: { key: string; seconds: number } | null) => void;
  /**
   * Whether the mini DOCK is on screen right now (set by
   * PlaybackHost). Tab screens add its height as bottom padding
   * so the dock never covers content or eats its taps (N-3).
   */
  dockVisible: boolean;
  setDockVisible: (visible: boolean) => void;
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
  item: restoredDock?.item ?? null,
  mode: restoredDock ? 'mini' : 'closed',
  playing: false,
  slotRect: null,
  routeName: null,
  watchKind: 'plain',
  coveredKey: null,
  setCoveredKey: (coveredKey) => set({ coveredKey }),
  suppressedKey: null,
  setSuppressedKey: (suppressedKey) => set({ suppressedKey }),
  // A restored dock ALWAYS hands back (fix round 6.1, #12):
  // with a rescuePosition on file, PlaybackHost's hand-back rule
  // mounts the player PAUSED (autoplay = the paused state) and
  // seeks to the saved spot. When the position was lost, the
  // hand-back still applies with 0 — paused at the start beats
  // auto-playing from the start.
  rescuePosition: restoredDock
    ? { key: restoredDock.item.key, seconds: restoredDock.seconds ?? 0 }
    : null,
  setRescuePosition: (rescuePosition) => set({ rescuePosition }),
  dockVisible: false,
  setDockVisible: (dockVisible) => set({ dockVisible }),
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
        // Keep a rect that was already measured FOR THIS ITEM
        // (fix round 6, mini restart): the Watch slot measures on
        // layout/focus, which on a slow phone happens BEFORE the
        // resolve finishes and open() runs — nulling that rect
        // left the host parked forever, the rescue player took
        // over, and minimising then restarted the video in a
        // fresh host player. A rect keyed to this item is this
        // item's slot, whenever it was measured.
        slotRect: same || s.slotRect?.key === item.key ? s.slotRect : null,
        coveredKey: same ? s.coveredKey : null,
        rescuePosition: same ? s.rescuePosition : null,
      };
    }),
  minimize: () =>
    set((s) => {
      if (!s.item) return s;
      if (s.item.kind === 'youtube') persistDock(s.item);
      return { mode: 'mini' };
    }),
  expand: () => set((s) => (s.item ? { mode: 'full' } : s)),
  close: () => {
    persistDock(null, null);
    set({ item: null, mode: 'closed', playing: false, slotRect: null, coveredKey: null, suppressedKey: null, rescuePosition: null });
  },
  setPlaying: (playing) => set({ playing }),
  setSlotRect: (slotRect) => set({ slotRect }),
  setRouteName: (routeName) => set({ routeName }),
  setWatchKind: (watchKind) => set({ watchKind }),
}));
