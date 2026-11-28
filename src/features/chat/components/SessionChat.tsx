/* eslint-disable react-hooks/refs --
 * P9/W4: the sheet height is an Animated.Value held in a ref; the
 * PanResponder handlers touch the Animated value / expanded ref ONLY
 * inside gesture callbacks and effects, never during render (same
 * stable-instance pattern as SwipeableRow, where this rule is also
 * disabled). The react-hooks/refs rule cannot prove that, so it is
 * disabled for this file only. */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  nativeApp,
  radii,
  spacing,
  typography,
  useTheme,
  type ThemeColors,
} from '../../../theme';
import { useSessionChat, type ChatUser } from '../useSessionChat';
import { formatCount } from '../../../lib/format';
import { ICON_HIT_SLOP, SMALL_ICON_HIT_SLOP } from '../../../lib/touch';
import type { ChatMessageWithAuthor } from '../types';
import { ChatMessageRow } from './ChatMessageRow';
import { ChatAvatar } from './ChatAvatar';

export interface SessionChatProps {
  sessionId: string;
  /**
   * Real participant count from the host (e.g. Realtime Presence).
   * If omitted, derived from `session_participants` when the caller
   * may read the roster; hidden when not knowable — never fabricated.
   */
  participantCount?: number;
  /** Signed-in user from the host app; omit to resolve from Supabase Auth. */
  currentUser?: ChatUser | null;
  /** Join state from the host; omit to check `session_participants`. */
  hasJoined?: boolean;
  /** Extra real author names (e.g. Presence roster): userId → name. */
  authorNames?: Record<string, string | null>;
  /** Close (×) handler — the sheet is hosted by the watch/session screen. */
  onClose?: () => void;
  /** Tapping the sign-in prompt (signed-out state). */
  onSignInPress?: () => void;
  /** Tapping "Join session" (signed-in, not-joined state). */
  onJoinPress?: () => void;
  /** Passed to KeyboardAvoidingView when hosted below a header/player. */
  keyboardVerticalOffset?: number;
}

const MAX_MESSAGE_LENGTH = 1000;

// The sheet root needs an animated height (P9/W4) — KeyboardAvoidingView's
// own style typing rejects Animated values, so wrap it once.
const AnimatedKeyboardAvoidingView = Animated.createAnimatedComponent(KeyboardAvoidingView);

/**
 * Session live chat — the bottom-sheet UI of screenshot 07, built on
 * real data only:
 *
 * - Sheet chrome: drag handle (90×5, measured), "Live chat" header
 *   (18px semibold — the size YouTube's own live-chat header uses)
 *   with a functional close button, and a sub-line with the REAL
 *   participant count when it is knowable. The community-guideline
 *   line sits as a slim caption under the header (where YouTube
 *   puts its welcome-to-chat text), and the composer is YouTube's
 *   bottom row: the member's own avatar beside the "Chat…" pill —
 *   no separate identity strip.
 * - Messages arrive via Supabase Realtime and history paginates on
 *   scroll-up; rows are memoised on an inverted FlatList.
 * - The crown (top-fans) and sliders (chat-settings) icons of the
 *   reference are deliberately NOT rendered: this app has no
 *   leaderboard or chat-mode feature behind them, and a button that
 *   does nothing would be fake functionality. The same applies to the
 *   reference's Super Chat ($) button and floating heart reaction.
 * - States are honest: signed-out → sign-in prompt; signed-in but not
 *   joined → join-first notice (RLS also blocks reading/posting);
 *   empty chat → an explicit "no messages yet" state.
 */
export function SessionChat({
  sessionId,
  participantCount,
  currentUser,
  hasJoined,
  authorNames,
  onClose,
  onSignInPress,
  onJoinPress,
  keyboardVerticalOffset = 0,
}: SessionChatProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const chat = useSessionChat(sessionId, {
    participantCount,
    currentUser,
    hasJoined,
    authorNames,
  });
  const [draft, setDraft] = useState('');
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);

  // Sheet sizing (round-2 ref-5): the sheet defaults to 72% of the
  // screen so the player stays visible above it, and drags up to 92%.
  // Drag is claimed ONLY by the handle/header region (move-based, so
  // taps on × still land) — the message list scrolls independently.
  const { height: windowHeight } = useWindowDimensions();
  // Expanded/collapsed lives in a ref: the height is animated, so a
  // state flip (and its re-render) is no longer what moves the sheet.
  const expandedRef = useRef(false);
  const clampHeight = useCallback(
    (h: number) => Math.max(240, Math.min(windowHeight * 0.98, h)),
    [windowHeight],
  );
  const baseHeightFor = useCallback(
    (exp: boolean) =>
      windowHeight *
      (exp ? nativeApp.chatSheet.expandedHeightRatio : nativeApp.chatSheet.defaultHeightRatio),
    [windowHeight],
  );
  // P9/W4: the sheet height is an Animated.Value. Drag moves it with
  // setValue (no re-render per move); release springs it to the snap
  // target (damping 26 / stiffness 260 per the audit's animation
  // spec). Height cannot use the native driver, so
  // useNativeDriver:false — the spring still runs on the JS thread at
  // frame cadence and the layout follows it.
  const heightAnim = useRef(new Animated.Value(clampHeight(baseHeightFor(false)))).current;
  // Keep the animated height in sync when the window itself changes
  // (rotation / resize) outside of a drag.
  React.useEffect(() => {
    heightAnim.setValue(clampHeight(baseHeightFor(expandedRef.current)));
  }, [baseHeightFor, clampHeight, heightAnim]);

  const springTo = useCallback(
    (exp: boolean) => {
      Animated.spring(heightAnim, {
        toValue: clampHeight(baseHeightFor(exp)),
        damping: 26,
        stiffness: 260,
        useNativeDriver: false,
      }).start();
    },
    [heightAnim, clampHeight, baseHeightFor],
  );

  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        // Move-based claiming: a drag (|dy| > 4) is sheet drag; a tap
        // falls through to the handle Pressable / × button underneath.
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderMove: (_evt, gesture) => {
          heightAnim.setValue(clampHeight(baseHeightFor(expandedRef.current) - gesture.dy));
        },
        onPanResponderRelease: (_evt, gesture) => {
          const threshold = nativeApp.chatSheet.dragSnapThreshold;
          if (gesture.dy > threshold) {
            if (expandedRef.current) {
              expandedRef.current = false;
              springTo(false);
            } else {
              springTo(false);
              onClose?.();
            }
          } else if (gesture.dy < -threshold) {
            expandedRef.current = true;
            springTo(true);
          } else {
            springTo(expandedRef.current);
          }
        },
        onPanResponderTerminate: () => springTo(expandedRef.current),
      }),
    [onClose, heightAnim, clampHeight, baseHeightFor, springTo],
  );

  // Inverted list: newest message first in data, rendered at the bottom.
  const invertedMessages = useMemo(() => chat.messages.slice().reverse(), [chat.messages]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessageWithAuthor }) => (
      <ChatMessageRow
        message={item}
        ownAvatarUrl={
          chat.user && item.user_id === chat.user.id ? (chat.user.avatarUrl ?? null) : null
        }
      />
    ),
    [chat.user],
  );
  const keyExtractor = useCallback((item: ChatMessageWithAuthor) => item.id, []);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || chat.sending) return;
    const sent = await chat.send(draft);
    if (sent) {
      setDraft('');
      // Keep the keyboard open and focus in the field so the sangat can
      // send a follow-up without tapping back in (esp. mobile web,
      // where submit would otherwise blur the input away).
      inputRef.current?.focus();
    }
  }, [chat, draft]);

  const canChat = Boolean(chat.user) && chat.hasJoined === true;
  const identityName = chat.user?.displayName?.trim() ? chat.user.displayName : null;

  let body: React.ReactNode;
  if (!chat.configured) {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>Chat is not available yet</Text>
        <Text style={styles.stateMessage}>
          The session backend is not configured, so chat cannot load.
        </Text>
      </View>
    );
  } else if (chat.authLoading || chat.hasJoined === null) {
    body = (
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  } else if (!chat.user) {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>Sign in to chat</Text>
        <Text style={styles.stateMessage}>
          Only signed-in sangat who have joined this session can read and post messages.
        </Text>
        {onSignInPress ? (
          <Pressable style={styles.stateButton} onPress={onSignInPress} accessibilityRole="button">
            <Text style={styles.stateButtonText}>Sign in</Text>
          </Pressable>
        ) : null}
      </View>
    );
  } else if (!canChat) {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>Join this session to chat</Text>
        <Text style={styles.stateMessage}>
          Chat opens once you have joined the session — joining is what lets you read and post.
        </Text>
        {onJoinPress ? (
          <Pressable style={styles.stateButton} onPress={onJoinPress} accessibilityRole="button">
            <Text style={styles.stateButtonText}>Join session</Text>
          </Pressable>
        ) : null}
      </View>
    );
  } else if (chat.loading) {
    body = (
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  } else if (chat.messages.length === 0) {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>No messages yet</Text>
        <Text style={styles.stateMessage}>
          Be the first to share in this session&rsquo;s chat.
        </Text>
        {chat.listError ? <Text style={styles.errorText}>{chat.listError}</Text> : null}
      </View>
    );
  } else {
    body = (
      <>
        {chat.listError ? (
          <Text style={styles.listErrorBanner}>{chat.listError}</Text>
        ) : null}
        <FlatList
        data={invertedMessages}
        inverted
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={chat.hasMore ? chat.loadMore : undefined}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          chat.loadingMore ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          ) : undefined
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={11}
        // Scroll smoothness (Phase 12): keep the viewport anchored
        // to the message the user is actually reading when the data
        // changes underneath it — a new message arriving (prepended
        // at index 0 of the inverted data) or a history page loading
        // in at the far end must not shift or jump the visible rows.
        // autoscrollToTopThreshold (inverted list: "top" = the
        // latest-message end) preserves the chat convention that a
        // user already sitting at the latest message follows new
        // arrivals, while a user scrolled up into history is left
        // exactly where they are. removeClippedSubviews is
        // deliberately NOT set: with variable-height inverted rows
        // it can blank rows mid-fling on Android.
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 100,
        }}
        style={styles.messageList}
      />
      </>
    );
  }

  return (
    <AnimatedKeyboardAvoidingView
      style={[styles.sheet, { height: heightAnim }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      {/* Drag region: handle + header + sub-line. Dragging up expands
          (72% → 92%), dragging down collapses, then closes; tapping
          the handle closes too. The message list is OUTSIDE this
          region and scrolls independently. */}
      <View {...dragResponder.panHandlers}>
      <Pressable
        style={styles.handleRow}
        onPress={onClose}
        disabled={!onClose}
        accessibilityRole={onClose ? 'button' : undefined}
        accessibilityLabel={onClose ? 'Close chat' : undefined}
        hitSlop={{ top: 14, bottom: 14, left: 24, right: 24 }}
      >
        <View style={styles.dragHandle} />
      </Pressable>

      <View style={styles.headerRow}>
        <Text style={styles.title}>Live chat</Text>
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close chat"
            hitSlop={ICON_HIT_SLOP}
          >
            <MaterialIcons name="close" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.subRow}>
        <Text style={styles.subLabel}>All messages</Text>
        {chat.participantCount !== null ? (
          <View style={styles.countWrap}>
            <MaterialIcons name="person" size={16} color={colors.textSecondary} />
            <Text style={styles.subLabel}>{formatCount(chat.participantCount)}</Text>
          </View>
        ) : null}
      </View>
      </View>

      <View style={styles.listArea}>{body}</View>

      {canChat ? (
        <>
          {/* The welcome notice sits directly above the composer —
              where YouTube puts its "Welcome to live chat!" box
              (user's reference screenshot, 28 Nov 2026); it used to
              sit under the header, where it read as a banner instead
              of part of the chat-entry moment. */}
          <View style={styles.noticeBar}>
            <Text style={styles.noticeText} numberOfLines={2}>
              Welcome to the Samagam chat. Please keep messages respectful — moderators may
              remove messages.
            </Text>
          </View>
          {chat.sendError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {chat.sendError} Your draft is kept below — tap Send to retry.
            </Text>
          ) : null}
          <View style={styles.inputRow}>
            {chat.user ? (
              <ChatAvatar
                userId={chat.user.id}
                displayName={identityName}
                avatarUrl={chat.user.avatarUrl ?? null}
                size={32}
              />
            ) : null}
            <View style={styles.inputPill}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Chat…"
                placeholderTextColor={colors.textSecondary}
                maxLength={MAX_MESSAGE_LENGTH}
                multiline
                returnKeyType="send"
                onSubmitEditing={() => void handleSend()}
                blurOnSubmit={false}
                enterKeyHint="send"
              />
              <Pressable
                onPress={() => void handleSend()}
                disabled={!draft.trim() || chat.sending}
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: !draft.trim() || chat.sending }}
                hitSlop={SMALL_ICON_HIT_SLOP}
                style={!draft.trim() ? styles.sendDisabled : undefined}
              >
                {chat.sending ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <MaterialIcons
                    name="send"
                    size={22}
                    color={draft.trim() ? colors.accent : colors.textSecondary}
                  />
                )}
              </Pressable>
            </View>
          </View>
          {draft.length > MAX_MESSAGE_LENGTH - 100 ? (
            <Text style={styles.charCount}>
              {draft.length} / {MAX_MESSAGE_LENGTH}
            </Text>
          ) : null}
        </>
      ) : null}
    </AnimatedKeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    overflow: 'hidden',
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    width: nativeApp.watchSheet.dragHandleWidth,
    height: nativeApp.watchSheet.dragHandleHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: {
    // YouTube's live-chat header size (their sheet title is a
    // compact semibold, not a page headline).
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.text,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.lg,
  },
  subLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  countWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  listArea: {
    flex: 1,
    minHeight: 0,
  },
  messageList: { flex: 1 },
  listErrorBanner: {
    ...typography.metadata,
    color: colors.accent,
    backgroundColor: colors.surfaceVariant,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.badge,
  },
  sendDisabled: { opacity: 0.5 },
  charCount: {
    ...typography.metadata,
    color: colors.textSecondary,
    textAlign: 'right',
    marginHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
  loadingMore: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  stateTitle: {
    ...typography.sectionTitle,
    color: colors.text,
    textAlign: 'center',
  },
  stateMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  stateButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  stateButtonText: {
    ...typography.chip,
    color: colors.subscribeText,
  },
  noticeBar: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: nativeApp.chatSheet.noticeRadius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.metadata,
    color: colors.accent,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44, // ref-5 "Chat…" pill height
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    maxHeight: 100,
    paddingVertical: 2,
  },
});
