import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * Device preferences (blueprint round 2, fault 35): Settings used
 * to offer a theme picker and two Clear buttons and nothing that
 * changed how the app BEHAVES. This store holds real preferences,
 * persisted on the device. Every preference here must be wired to
 * actual behaviour — a toggle that changes nothing is worse than
 * no toggle.
 *
 * - autoplay: whether a recording starts playing on its own when
 *   opened (Watch / mini player) and whether Shorts autostart.
 *   Default ON (the behaviour the app shipped with). Sessions are
 *   NOT governed by it: a Samagam Session is a synced group
 *   playback and always starts at its offset.
 */
const STORAGE_KEY = 'haftawari.preferences.v1';

interface PreferencesState {
  autoplay: boolean;
  /**
   * Default playback speed for HOSTED recordings (the sangat's own
   * hosted player supports real rate control; the official YouTube
   * embed's speed stays in its own settings, and live sessions
   * lock the rate to stay in sync — neither is governed by this).
   */
  hostedSpeed: number;
  hydrated: boolean;
  setAutoplay: (value: boolean) => void;
  setHostedSpeed: (value: number) => void;
  hydrate: () => Promise<void>;
}

function persist(state: { autoplay: boolean; hostedSpeed: number }): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  autoplay: true,
  hostedSpeed: 1,
  hydrated: false,
  setAutoplay: (value) => {
    set({ autoplay: value });
    persist({ autoplay: value, hostedSpeed: get().hostedSpeed });
  },
  setHostedSpeed: (value) => {
    set({ hostedSpeed: value });
    persist({ autoplay: get().autoplay, hostedSpeed: value });
  },
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { autoplay?: unknown; hostedSpeed?: unknown };
        if (typeof parsed.autoplay === 'boolean') set({ autoplay: parsed.autoplay });
        if (typeof parsed.hostedSpeed === 'number' && parsed.hostedSpeed >= 0.25 && parsed.hostedSpeed <= 3) {
          set({ hostedSpeed: parsed.hostedSpeed });
        }
      }
    } catch {
      // Unreadable storage: the defaults stand.
    }
    set({ hydrated: true });
  },
}));

// Hydrate once at startup (idempotent; consumers read the default
// until it lands, which for a boolean preference is harmless).
void usePreferencesStore.getState().hydrate();
