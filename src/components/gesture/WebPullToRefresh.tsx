import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { lightColors } from '../../theme';

/**
 * Web pull-to-refresh (UX Fix 2, gestures round).
 *
 * Why this exists: react-native-web's RefreshControl is a NO-OP STUB
 * (verified in the installed package: it renders an empty View and
 * never calls onRefresh). Every FlatList `refreshing`/`onRefresh`
 * pair in this app therefore works in the Android APK and silently
 * does NOTHING in the PWA — the live audit and a 412px touch test
 * both confirmed a clean pull at the top of Home produced no
 * indicator and no refetch.
 *
 * This hook restores the gesture on web only, without touching the
 * native path:
 *
 *   const ptr = useWebPullToRefresh({ onRefresh, refreshing });
 *   <View style={styles.flex}>
 *     {ptr.indicator}
 *     <FlatList {...ptr.listProps} />
 *   </View>
 *
 * How it works: the handlers ride on the LIST itself (FlatList
 * forwards them to its ScrollView — the actual touch target; in
 * react-native-web, onTouch* on an ANCESTOR view does not reliably
 * receive a scroll child's moves, verified by a DOM-level probe).
 * Nothing is ever claimed or blocked, so scrolling is untouched.
 * When a touch STARTS while the list is at the very top and drags
 * downward, the pull distance is tracked; the indicator follows the
 * finger; releasing past the threshold (72px) fires onRefresh once.
 * Pulling from anywhere else (mid-list, upward) is ignored.
 * On native every prop is an inert no-op and the indicator is null:
 * the platform RefreshControl there is real and stays in charge.
 */

const THRESHOLD = 72;
const MAX_PULL = 110;
const IS_WEB = Platform.OS === 'web';

interface WebPullToRefreshOptions {
  onRefresh: () => void;
  refreshing: boolean;
}

export interface WebPullToRefresh {
  /** Spread onto the FlatList/ScrollView: touch tracking + onScroll. */
  listProps: {
    onTouchStart?: (e: GestureResponderEvent) => void;
    onTouchMove?: (e: GestureResponderEvent) => void;
    onTouchEnd?: () => void;
    onTouchCancel?: () => void;
    onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
    scrollEventThrottle?: number;
  };
  indicator: ReactNode;
}

/**
 * The Y of the first touch. Native RN puts pageY on the event itself;
 * react-native-web only fills `touches[0].pageY` (verified live: on
 * web, nativeEvent.pageY is undefined and every dy came out NaN).
 */
function touchPageY(e: GestureResponderEvent): number | null {
  const ne = e.nativeEvent as unknown as {
    pageY?: number;
    touches?: { pageY?: number }[];
  };
  const y = ne.touches?.[0]?.pageY ?? ne.pageY;
  return typeof y === 'number' && Number.isFinite(y) ? y : null;
}

export function useWebPullToRefresh({
  onRefresh,
  refreshing,
}: WebPullToRefreshOptions): WebPullToRefresh {
  const [pull, setPull] = useState(0);
  const offsetRef = useRef(0);
  const startYRef = useRef<number | null>(null);
  const startAtTopRef = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(refreshing);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshingRef.current = refreshing;
    onRefreshRef.current = onRefresh;
  }, [refreshing, onRefresh]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    startYRef.current = touchPageY(e);
    startAtTopRef.current = offsetRef.current <= 1;
  }, []);

  const onTouchMove = useCallback((e: GestureResponderEvent) => {
    if (startYRef.current === null || !startAtTopRef.current || refreshingRef.current) {
      return;
    }
    const y = touchPageY(e);
    if (y === null) return;
    const dy = y - startYRef.current;
    if (dy <= 0) {
      if (pullRef.current !== 0) {
        pullRef.current = 0;
        setPull(0);
      }
      return;
    }
    const next = Math.min(dy, MAX_PULL);
    // Re-render at most every ~4px of travel — the indicator is one
    // small element, and this keeps the gesture thread light.
    if (Math.abs(next - pullRef.current) >= 4 || next === MAX_PULL) {
      pullRef.current = next;
      setPull(next);
    }
  }, []);

  const finish = useCallback(() => {
    const shouldRefresh =
      startAtTopRef.current && pullRef.current >= THRESHOLD && !refreshingRef.current;
    startYRef.current = null;
    startAtTopRef.current = false;
    // The indicator's engaged position is DERIVED from `refreshing`
    // at render (see below), so here the tracked pull simply resets:
    // onRefresh flips the owner's refreshing flag in the same tick,
    // and the derivation takes over seamlessly.
    pullRef.current = 0;
    setPull(0);
    if (shouldRefresh) {
      onRefreshRef.current();
    }
  }, []);

  if (!IS_WEB) {
    return { listProps: {}, indicator: null };
  }

  const displayPull = refreshing ? 56 : pull;
  const engaged = refreshing || pull >= THRESHOLD;
  const indicator =
    displayPull > 0 ? (
      <View
        pointerEvents="none"
        style={[
          styles.indicator,
          {
            transform: [{ translateY: -44 + Math.min(displayPull, 60) }],
            opacity: Math.min(1, displayPull / 40),
          },
        ]}
      >
        {refreshing ? (
          <ActivityIndicator color={lightColors.text} size="small" />
        ) : (
          <MaterialIcons
            name="arrow-downward"
            size={20}
            color={engaged ? lightColors.accent : lightColors.textSecondary}
          />
        )}
      </View>
    ) : null;

  return {
    listProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd: finish,
      onTouchCancel: finish,
      onScroll,
      scrollEventThrottle: 16,
    },
    indicator,
  };
}

const styles = StyleSheet.create({
  indicator: {
    position: 'absolute',
    top: 6,
    alignSelf: 'center',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: lightColors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: lightColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    elevation: 4,
  },
});
