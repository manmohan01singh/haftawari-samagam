import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { nativeApp, radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import { useCurrentChatUser, type ChatUser } from '../useSessionChat';
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
   * Prominent mode — used when the session is NOW PLAYING, so the live
   * chat entry is obvious rather than buried: accent outline, a filled
   * "Open live chat" action and a NOW PLAYING caption (the status text
   * is the host's real session status, passed in by the caller).
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
    <View
      style={[styles.card, prominent && styles.cardProminent]}
      accessibilityLabel={`Live chat for session ${sessionId}`}
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          Live chat{prominent ? ' · NOW PLAYING' : ''}
        </Text>
        <View style={styles.headerRight}>
          {participantCount !== undefined ? (
            <View style={styles.countWrap}>
              <MaterialIcons name="person" size={16} color={colors.textSecondary} />
              <Text style={styles.countText}>{participantCount}</Text>
            </View>
          ) : null}
          <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />
        </View>
      </View>
      <Pressable style={styles.inputRow} onPress={handlePress} accessibilityRole="button">
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
      </Pressable>
      {prominent ? (
        <Pressable style={styles.openButton} onPress={handlePress} accessibilityRole="button">
          <Text style={styles.openButtonText}>Open live chat</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: nativeApp.chatCard.radius,
    padding: nativeApp.chatCard.padding,
  },
  cardProminent: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  openButton: {
    marginTop: spacing.md,
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingVertical: 10,
    alignItems: 'center',
  },
  openButtonText: { ...typography.chip, color: colors.subscribeText },
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
