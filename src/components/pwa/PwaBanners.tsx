import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { lightColors, radii, spacing, typography } from '../../theme';
import {
  INSTALL_AVAILABLE_EVENT,
  SW_UPDATE_EVENT,
  applyPwaUpdate,
  hasPwaInstallPrompt,
  promptPwaInstall,
} from '../../lib/registerServiceWorker';

const INSTALL_DISMISSED_KEY = 'haftawari:install-dismissed';

/**
 * PWA shell banners (web only; renders nothing on native):
 *  - Update: shown only when a new service worker is actually waiting
 *    (event from registerServiceWorker.web). "Update" activates it and
 *    the page reloads once onto the new version. "Later" hides it for
 *    this page view; the check runs again on next focus/load.
 *  - Install: shown only after the browser fired beforeinstallprompt
 *    (i.e. the app is genuinely installable here) and the user has not
 *    dismissed it before (localStorage). Tapping replays the browser's
 *    own prompt — there is no fake install flow.
 */
export function PwaBanners() {
  const [updateReady, setUpdateReady] = useState(false);
  const [installReady, setInstallReady] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onUpdate = () => setUpdateReady(true);
    const onInstall = () => {
      try {
        if (window.localStorage.getItem(INSTALL_DISMISSED_KEY) === '1') return;
      } catch {
        // Storage unavailable — still show; dismissal just won't persist.
      }
      setInstallReady(true);
    };
    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    window.addEventListener(INSTALL_AVAILABLE_EVENT, onInstall);
    if (hasPwaInstallPrompt()) onInstall();
    return () => {
      window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
      window.removeEventListener(INSTALL_AVAILABLE_EVENT, onInstall);
    };
  }, []);

  if (Platform.OS !== 'web') return null;

  if (updateReady) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.banner}>
          <Text style={styles.text}>A new version of Haftawari Samagam is available.</Text>
          <Pressable style={styles.primary} onPress={() => applyPwaUpdate()} accessibilityRole="button">
            <Text style={styles.primaryText}>Tap to update</Text>
          </Pressable>
          <Pressable onPress={() => setUpdateReady(false)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.dismiss}>Later</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (installReady) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.banner}>
          <Text style={styles.text}>Install Haftawari Samagam on this device.</Text>
          <Pressable
            style={styles.primary}
            onPress={() => {
              void promptPwaInstall().then(() => setInstallReady(false));
            }}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Install</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              try {
                window.localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
              } catch {
                // Best-effort persistence only.
              }
              setInstallReady(false);
            }}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={styles.dismiss}>Not now</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    padding: spacing.md,
    zIndex: 100,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: 560,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  text: { ...typography.body, color: lightColors.subscribeText, flexShrink: 1 },
  primary: {
    backgroundColor: lightColors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryText: { ...typography.chip, color: lightColors.text },
  dismiss: { ...typography.chip, color: lightColors.subscribeText },
});
