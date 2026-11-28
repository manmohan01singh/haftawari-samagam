import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { nativeApp, radii, spacing, useTheme, type ThemeColors } from '../../../theme';
import { useCurrentChatUser, type ChatUser } from '../useSessionChat';
import { formatCount } from '../../../lib/format';
import { ChatAvatar } from './ChatAvatar';

export interface ChatPreviewCardProps {
  sessionId: string;
  /** Opens the full chat (SessionChat sheet). */
  onPress?: () => void;
  /**
   * Real participant count from the host (e.g. Presence). Shown only
   * when supplied — the card never invents a count.
   */
  participantCount?: number;
  /** Signed-in user from the host app; omit to resolve from Supabase Auth. */
  currentUser?: ChatUser | null;
  /** Tapping the pill while signed out (defaults to onPress). */
  onSignInPress?: () => void;
  /**
   * Prominent mode — used when the session is NOW PLAYING: the header
   * gains a red NOW PLAYING caption (the host's real session status,
   * passed in by the caller). The card fill stays the standard one —
   * YouTube's live chat card is a quiet grey box, not a red frame.
   */
  prominent?: boolean;
}

/**
 * The "Live chat" card that sits under the player on the watch page
 * (screenshot 06): inset container, light grey fill, radius 16, header
 * row ("Live chat" + real count when known), and the signed-in user's
 * avatar beside a lighter input pill reading "Chat publicly as …".
 * The pill is a doorway into the full chat sheet — typing happens in
 * SessionChat, so nothing here pretends to be an editor.
 */
export function ChatPreviewCard({
  sessionId,
  onPress,
  participantCount,
  currentUser,
  onSignInPress,
  prominent = false,
}: ChatPreviewCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, authLoading } = useCurrentChatUser(currentUser);
  const identityName = user?.displayName?.trim() ? user.displayName : null;

  const pillText = authLoading
    ? 'Loading…'
    : user
      ? identityName
        ? `Chat publicly as ${identityName}…`
        : 'Chat publicly…'
      : 'Sign in to chat';

  const handlePress = () => {
    if (!user && onSignInPress) {
      onSignInPress();
      return;
    }
    onPress?.();
  };

  return (
    // The WHOLE card is the tap target (audit B4): the header row's
    // chevron used to be a dead zone, and prominent mode duplicated
    // the action with a second full-width button. One Pressable,
    // one obvious affordance — YouTube's chat card works this way.
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Live chat for session ${sessionId}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          Live chat
          {prominent ? <Text style={styles.nowPlayingText}> · NOW PLAYING</Text> : null}
        </Text>
        <View style={styles.headerRight}>
          {participantCount !== undefined ? (
            <View style={styles.countWrap}>
              <MaterialIcons name="person" size={16} color={colors.textSecondary} />
              <Text style={styles.countText}>{formatCount(participantCount)}</Text>
            </View>
          ) : null}
          <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
        </View>
      </View>
      <View style={styles.inputRow}>
        {user ? (
          <ChatAvatar userId={user.id} displayName={user.displayName} />
        ) : (
          <View style={styles.signedOutAvatar}>
            <MaterialIcons name="person" size={22} color={colors.textSecondary} />
          </View>
        )}
        <View style={styles.pill}>
          <Text style={styles.pillText} numberOfLines={1}>
            {pillText}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: nativeApp.chatCard.radius,
    padding: nativeApp.chatCard.padding,
  },
  cardPressed: { opacity: 0.92 },
  nowPlayingText: { color: colors.accent },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  countText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  signedOutAvatar: {
    width: nativeApp.chatSheet.avatarSize,
    height: nativeApp.chatSheet.avatarSize,
    borderRadius: nativeApp.chatSheet.avatarSize / 2,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pill: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
