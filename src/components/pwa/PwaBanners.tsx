import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
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
const IOS_DISMISSED_KEY = 'haftawari:ios-install-dismissed';
const OFFLINE_TEXT = "You're offline — showing the app shell; samagams need internet.";

/** iOS Safari has no beforeinstallprompt; installation there is the
 * real Share → Add to Home Screen flow, so instructions are the only
 * honest affordance. Detected by UA + not already standalone. */
function isIosSafari(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  return isIos && isSafari && !standalone;
}

export function PwaBanners() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [updateReady, setUpdateReady] = useState(false);
  const [installReady, setInstallReady] = useState(false);
  const [iosInstall, setIosInstall] = useState<boolean>(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
    try {
      return isIosSafari() && window.localStorage.getItem(IOS_DISMISSED_KEY) !== '1';
    } catch {
      return isIosSafari();
    }
  });
  const [offline, setOffline] = useState(false);

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
    // Offline state (QA 103): a visible banner whenever the browser
    // reports offline, clearing itself when connectivity returns.
    const syncOnline = () => setOffline(!navigator.onLine);
    syncOnline();
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    return () => {
      window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
      window.removeEventListener(INSTALL_AVAILABLE_EVENT, onInstall);
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
    };
  }, []);

  if (Platform.OS !== 'web') return null;

  if (offline) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.banner, styles.offlineBanner]}>
          <Text style={styles.text}>{OFFLINE_TEXT}</Text>
        </View>
      </View>
    );
  }

  if (updateReady) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.banner}>
          <Text style={styles.text}>A new version of YouTube Gurbani is available.</Text>
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
          <Text style={styles.text}>Install YouTube Gurbani on this device.</Text>
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

  if (iosInstall) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.banner}>
          <Text style={styles.text}>
            Install YouTube Gurbani: tap Share, then “Add to Home Screen”.
          </Text>
          <Pressable
            onPress={() => {
              try {
                window.localStorage.setItem(IOS_DISMISSED_KEY, '1');
              } catch {
                // Best-effort persistence only.
              }
              setIosInstall(false);
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
    backgroundColor: colors.subscribeBackground,
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
  text: { ...typography.body, color: colors.subscribeText, flexShrink: 1 },
  offlineBanner: { backgroundColor: colors.accent },
  primary: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryText: { ...typography.chip, color: colors.text },
  dismiss: { ...typography.chip, color: colors.subscribeText },
});
