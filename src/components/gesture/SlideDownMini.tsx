import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  type GestureResponderHandlers,
  type ViewStyle,
} from 'react-native';

/**
 * Slide-down-to-mini-player gesture layer (UX Fix 2, gestures round).
 *
 * The user's order: "gesture slide down te mini player ban jave" — a
 * downward drag on the Watch player / sheet must track the finger and
 * collapse playback into a mini player. Page—Watch owns the mini
 * player's look and any navigator-level behaviour; THIS hook owns the
 * gesture itself and the collapse/expand state machine, with a clean
 * handoff:
 *
 *   const mini = useSlideDownMini();
 *   <Animated.View style={mini.containerStyle}>…player + list…</Animated.View>
 *   <View {...mini.panHandlers}>…player area…</View>
 *   <View {...mini.panHandlers}>…sheet area…</View>
 *   {mini.mini ? <MiniBar onExpand={mini.expand} /> : null}
 *
 * Behaviour contract:
 *  - Taps are NEVER claimed (onStartShouldSetPanResponder = false), so
 *    buttons inside the drag surfaces keep working exactly as before.
 *  - A move is claimed only when it is clearly a downward vertical
 *    drag (dy > 6 and dy > 1.5·|dx|) — horizontal swipes, vertical
 *    scrolls of other surfaces and diagonal noise are left alone.
 *  - Once claimed, the gesture is kept (terminationRequest = false):
 *    the enclosing FlatList cannot steal it mid-drag, which is what
 *    made sheet drags feel broken.
 *  - While dragging, the container translates 1:1 with the finger on
 *    the native driver (interpolated + clamped), so the motion is
 *    smooth and does not depend on JS re-renders.
 *  - Release past the threshold (110px) or a downward flick
 *    (vy > 0.4) finishes the slide and collapses; anything less
 *    springs back. onCollapseRequest / onExpand fire for owners that
 *    want to plug in their own mini logic instead of the built-in
 *    `mini` state.
 *
 * Platform truth: on web, drags that START on the YouTube iframe
 * itself are delivered to the iframe, not the page — no gesture layer
 * can intercept those. The sheet area below the player is the
 * reliable drag surface there; on the player area the handler covers
 * the non-iframe states (poster/loading) and native, where the
 * wrapper view can claim the move.
 *
 * Implementation note: the PanResponder is created in an effect and
 * its handlers are published through state. This codebase's
 * react-hooks rules forbid reading refs anywhere the compiler treats
 * as render (including a useRef/useState initializer), and the
 * responder callbacks must read the LATEST enabled/mini/options —
 * refs synced in effects are the sanctioned pattern for that.
 */

const COLLAPSE_THRESHOLD = 110;
const FLICK_VELOCITY = 0.4;

export interface SlideDownMini {
  /** True while collapsed to the mini player. */
  mini: boolean;
  /** Collapse programmatically (finishes the slide animation first if mid-gesture). */
  collapse: () => void;
  /** Expand back to the full Watch layout. */
  expand: () => void;
  /** Spread onto each drag surface (player area, sheet area). */
  panHandlers: GestureResponderHandlers;
  /** Animated style for the sliding container (transform only). */
  containerStyle: ViewStyle;
}

interface SlideDownMiniOptions {
  /** Owner hook: called instead of the built-in collapse when provided. */
  onCollapseRequest?: () => void;
  /** Owner hook: called whenever the mini state expands. */
  onExpand?: () => void;
  /** Disable the gesture entirely (e.g. while a modal sheet is open). */
  enabled?: boolean;
}

export function useSlideDownMini(options: SlideDownMiniOptions = {}): SlideDownMini {
  const [mini, setMini] = useState(false);
  const miniRef = useRef(false);
  const enabledRef = useRef(true);
  const optionsRef = useRef(options);
  const [panHandlers, setPanHandlers] = useState<GestureResponderHandlers>({});

  // Latest options/enabled/mini reach the stable gesture callbacks
  // through refs synced in effects — never touched during render.
  useEffect(() => {
    optionsRef.current = options;
    enabledRef.current = options.enabled !== false;
  });

  useEffect(() => {
    miniRef.current = mini;
  }, [mini]);

  const maxDrag = Math.round(Dimensions.get('window').height * 0.5);
  const [dragY] = useState(() => new Animated.Value(0));

  const collapse = useCallback(() => {
    Animated.timing(dragY, {
      toValue: maxDrag,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      dragY.setValue(0);
      if (optionsRef.current.onCollapseRequest) {
        optionsRef.current.onCollapseRequest();
      } else {
        miniRef.current = true;
        setMini(true);
      }
    });
  }, [dragY, maxDrag]);

  const expand = useCallback(() => {
    miniRef.current = false;
    setMini(false);
    dragY.setValue(0);
    optionsRef.current.onExpand?.();
  }, [dragY]);

  const springBack = useCallback(() => {
    Animated.spring(dragY, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 60,
    }).start();
  }, [dragY]);

  // Create the responder once (stable callbacks read refs, so it
  // never needs recreating) and publish its handlers through state.
  useEffect(() => {
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        enabledRef.current &&
        !miniRef.current &&
        gesture.dy > 6 &&
        gesture.dy > Math.abs(gesture.dx) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: Animated.event([null, { dy: dragY }], {
        useNativeDriver: true,
      }),
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dy > COLLAPSE_THRESHOLD || gesture.vy > FLICK_VELOCITY) {
          collapse();
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: () => {
        springBack();
      },
    });
    setPanHandlers(responder.panHandlers);
  }, [collapse, dragY, springBack]);

  const containerStyle = useMemo<ViewStyle>(
    () => ({
      transform: [
        {
          translateY: dragY.interpolate({
            inputRange: [0, maxDrag],
            outputRange: [0, maxDrag],
            extrapolate: 'clamp',
          }),
        },
      ],
    }),
    [dragY, maxDrag],
  );

  return {
    mini,
    collapse,
    expand,
    panHandlers,
    containerStyle,
  };
}
