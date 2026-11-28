import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { nativeApp, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import { formatCount } from '../../../lib/format';
import { ChatAvatar } from '../../chat/components/ChatAvatar';
import { UNKNOWN_AUTHOR_LABEL } from '../../chat/components/ChatMessageRow';
import type { EngagementStatus } from '../useVideoEngagement';
import type { VideoCommentWithAuthor } from '../videoEngagementService';

export interface CommentsPreviewRowProps {
  status: EngagementStatus;
  /** Real comment count; null while unknown (loading/unavailable). */
  count: number | null;
  /** Newest real comment, shown as the preview (YouTube pattern). */
  topComment: VideoCommentWithAuthor | null;
  /** The signed-in user's own photo, only for their own preview row. */
  ownUserId: string | null;
  /** Whether a user is signed in — the empty state must not invite
   *  a guest to "be the first" when commenting needs an account. */
  signedIn?: boolean;
  ownAvatarUrl: string | null;
  onPress: () => void;
}

/**
 * The Watch page's Comments entry (YouTube pattern, Phase 13): a
 * rounded box under the description carrying the "Comments" label,
 * the REAL comment count and a preview of the newest real comment.
 * Tapping opens the full VideoCommentsSheet. Counts and previews are
 * only ever rendered from real rows — while the backend is missing
 * (migration 0005 not yet applied) the box says so plainly instead of
 * showing a number.
 */
export function CommentsPreviewRow({
  status,
  count,
  topComment,
  ownUserId,
  ownAvatarUrl,
  signedIn = true,
  onPress,
}: CommentsPreviewRowProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const topName = topComment?.author.displayName?.trim()
    ? topComment.author.displayName
    : UNKNOWN_AUTHOR_LABEL;

  return (
    <Pressable
      style={styles.box}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open comments"
    >
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Sangat comments</Text>
        {status === 'ready' && count != null ? (
          <Text style={styles.headerCount}>{formatCount(count)}</Text>
        ) : null}
        <View style={styles.headerSpacer} />
        {status === 'loading' ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <MaterialIcons name="expand-more" size={20} color={colors.textSecondary} />
        )}
      </View>
      {status === 'ready' && topComment ? (
        <View style={styles.previewRow}>
          <ChatAvatar
            userId={topComment.user_id}
            displayName={topComment.author.displayName}
            avatarUrl={topComment.user_id === ownUserId ? ownAvatarUrl : null}
            size={24}
          />
          <Text style={styles.previewText} numberOfLines={1} ellipsizeMode="tail">
            <Text style={styles.previewName}>{topName}  </Text>
            {topComment.body}
          </Text>
        </View>
      ) : status === 'ready' ? (
        <Text style={styles.noteText}>
          {signedIn ? 'No comments yet — be the first to share.' : 'No comments yet — sign in to share the first.'}
        </Text>
      ) : status === 'unavailable' ? (
        <Text style={styles.noteText}>Comments are not available yet.</Text>
      ) : status === 'error' ? (
        <Text style={styles.noteText}>Comments could not be loaded — tap to open and retry.</Text>
      ) : (
        <Text style={styles.noteText}>Loading comments…</Text>
      )}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  box: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: nativeApp.chatCard.radius,
    padding: nativeApp.chatCard.padding,
    marginTop: spacing.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerLabel: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.text },
  headerCount: { ...typography.metadata, color: colors.textSecondary },
  headerSpacer: { flex: 1 },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  previewText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.text },
  previewName: { fontWeight: '600', color: colors.textSecondary },
  noteText: { ...typography.metadata, color: colors.textSecondary, marginTop: spacing.sm },
});
