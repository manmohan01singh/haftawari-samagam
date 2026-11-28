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
  hydrated: boolean;
  setAutoplay: (value: boolean) => void;
  hydrate: () => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  autoplay: true,
  hydrated: false,
  setAutoplay: (value) => {
    set({ autoplay: value });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ autoplay: value })).catch(
      () => undefined,
    );
  },
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { autoplay?: unknown };
        if (typeof parsed.autoplay === 'boolean') set({ autoplay: parsed.autoplay });
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
