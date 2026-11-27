import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
import { formatCount, timeAgo } from '../../../lib/format';
import { ICON_HIT_SLOP, SMALL_ICON_HIT_SLOP } from '../../../lib/touch';
import { ChatAvatar } from '../../chat/components/ChatAvatar';
import { UNKNOWN_AUTHOR_LABEL } from '../../chat/components/ChatMessageRow';
import type { useVideoEngagement } from '../useVideoEngagement';
import type { VideoCommentWithAuthor } from '../videoEngagementService';

type Engagement = ReturnType<typeof useVideoEngagement>;

export interface VideoCommentsSheetProps {
  engagement: Engagement;
  /** Signed-in user (id + real display name), or null when signed out. */
  user: { id: string; displayName: string | null; avatarUrl: string | null } | null;
  onClose?: () => void;
  /** Tapping the sign-in prompt (signed-out composer). */
  onSignInPress?: () => void;
}

const MAX_COMMENT_LENGTH = 1000;

/** One comment row: avatar, name + relative time, body; own rows get a delete affordance. */
const VideoCommentRow = React.memo(function VideoCommentRow({
  comment,
  isOwn,
  ownAvatarUrl,
  onDelete,
}: {
  comment: VideoCommentWithAuthor;
  isOwn: boolean;
  ownAvatarUrl: string | null;
  onDelete: (commentId: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [confirming, setConfirming] = useState(false);
  const name = comment.author.displayName?.trim()
    ? comment.author.displayName
    : UNKNOWN_AUTHOR_LABEL;
  return (
    <View style={styles.row}>
      <ChatAvatar
        userId={comment.user_id}
        displayName={comment.author.displayName}
        avatarUrl={isOwn ? ownAvatarUrl : null}
      />
      <View style={styles.rowMain}>
        <Text style={styles.rowMeta}>
          <Text style={styles.rowName}>{name}</Text>
          <Text style={styles.rowTime}>{`  ·  ${timeAgo(comment.created_at)}`}</Text>
        </Text>
        <Text style={styles.rowBody}>{comment.body}</Text>
        {isOwn ? (
          <Pressable
            onPress={() => {
              if (confirming) {
                setConfirming(false);
                onDelete(comment.id);
              } else {
                setConfirming(true);
              }
            }}
            hitSlop={SMALL_ICON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={confirming ? 'Tap again to delete your comment' : 'Delete your comment'}
            style={styles.deleteRow}
          >
            <MaterialIcons
              name="delete-outline"
              size={16}
              color={confirming ? colors.accent : colors.textSecondary}
            />
            <Text style={[styles.deleteText, confirming && styles.deleteTextConfirm]}>
              {confirming ? 'Tap again to delete' : 'Delete'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

/**
 * Comments sheet for a RECORDED video (Phase 13) — the full list +
 * composer behind the Watch page's Comments preview row. Chrome
 * follows SessionChat (drag handle, bold header, close ×, input
 * pill) so the two sheets feel like one app; the data is entirely
 * separate (video_comments, public-read, no join gate).
 *
 * States are honest: signed-out → a sign-in prompt instead of a
 * composer (no fake posting); backend missing (migration 0005 not
 * applied yet) → a clear "not available yet" state; empty → an
 * explicit no-comments state. Only real rows are ever listed.
 */
export function VideoCommentsSheet({
  engagement,
  user,
  onClose,
  onSignInPress,
}: VideoCommentsSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const {
    commentsStatus,
    comments,
    commentCount,
    commentsHasMore,
    loadingMore,
    loadMoreComments,
    posting,
    postError,
    postComment,
    deleteComment,
    retryLoad,
  } = engagement;

  const renderItem = useCallback(
    ({ item }: { item: VideoCommentWithAuthor }) => (
      <VideoCommentRow
        comment={item}
        isOwn={Boolean(user) && item.user_id === user?.id}
        ownAvatarUrl={user?.avatarUrl ?? null}
        onDelete={(id) => void deleteComment(id)}
      />
    ),
    [user, deleteComment],
  );
  const keyExtractor = useCallback((item: VideoCommentWithAuthor) => item.id, []);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || posting) return;
    const sent = await postComment(draft);
    if (sent) {
      setDraft('');
      inputRef.current?.focus();
    }
  }, [draft, posting, postComment]);

  let body: React.ReactNode;
  if (commentsStatus === 'loading') {
    body = (
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  } else if (commentsStatus === 'unavailable') {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>Comments are not available yet</Text>
        <Text style={styles.stateMessage}>
          Comments for recordings are still being set up. Please check back soon.
        </Text>
      </View>
    );
  } else if (commentsStatus === 'error') {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>Comments could not be loaded</Text>
        <Text style={styles.stateMessage}>Something went wrong while loading comments.</Text>
        <Pressable style={styles.stateButton} onPress={() => void retryLoad()} accessibilityRole="button">
          <Text style={styles.stateButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (comments.length === 0) {
    body = (
      <View style={styles.centerState}>
        <Text style={styles.stateTitle}>No comments yet</Text>
        <Text style={styles.stateMessage}>Be the first to share about this recording.</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={comments}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={commentsHasMore ? () => void loadMoreComments() : undefined}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
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
        style={styles.list}
      />
    );
  }

  const identityName = user?.displayName?.trim() ? user.displayName : null;

  return (
    <KeyboardAvoidingView
      style={[styles.sheet, { height: Math.round(windowHeight * 0.85) }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.handleRow}>
        <View style={styles.dragHandle} />
      </View>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Comments</Text>
        {commentsStatus === 'ready' && commentCount != null ? (
          <Text style={styles.headerCount}>{formatCount(commentCount)}</Text>
        ) : null}
        <View style={styles.headerSpacer} />
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close comments"
            hitSlop={ICON_HIT_SLOP}
          >
            <MaterialIcons name="close" size={24} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.listArea}>{body}</View>

      {commentsStatus !== 'unavailable' ? (
        user ? (
          <>
            <View style={styles.identityRow}>
              <ChatAvatar
                userId={user.id}
                displayName={identityName}
                avatarUrl={user.avatarUrl ?? null}
                size={24}
              />
              <Text style={styles.identityText}>
                {identityName
                  ? `Comment publicly as ${identityName}`
                  : 'Comment publicly — no display name is set on your profile.'}
              </Text>
            </View>
            {postError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {postError} Your draft is kept below — tap Send to retry.
              </Text>
            ) : null}
            <View style={styles.inputRow}>
              <View style={styles.inputPill}>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Add a comment…"
                  placeholderTextColor={colors.textSecondary}
                  maxLength={MAX_COMMENT_LENGTH}
                  multiline
                  returnKeyType="send"
                  onSubmitEditing={() => void handleSend()}
                  blurOnSubmit={false}
                  enterKeyHint="send"
                />
                <Pressable
                  onPress={() => void handleSend()}
                  disabled={!draft.trim() || posting}
                  accessibilityRole="button"
                  accessibilityLabel="Post comment"
                  accessibilityState={{ disabled: !draft.trim() || posting }}
                  hitSlop={SMALL_ICON_HIT_SLOP}
                  style={!draft.trim() ? styles.sendDisabled : undefined}
                >
                  {posting ? (
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
          </>
        ) : (
          <View style={styles.signInRow}>
            <Pressable
              style={styles.stateButton}
              onPress={onSignInPress}
              accessibilityRole="button"
            >
              <Text style={styles.stateButtonText}>Sign in to comment</Text>
            </Pressable>
          </View>
        )
      ) : null}
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    overflow: 'hidden',
  },
  handleRow: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  dragHandle: {
    width: nativeApp.watchSheet.dragHandleWidth,
    height: nativeApp.watchSheet.dragHandleHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: colors.text },
  headerCount: { ...typography.body, color: colors.textSecondary },
  headerSpacer: { flex: 1 },
  listArea: { flex: 1, minHeight: 0 },
  list: { flex: 1 },
  listContent: { paddingVertical: spacing.sm },
  loadingMore: { paddingVertical: spacing.md, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowMain: { flex: 1, marginLeft: spacing.md },
  rowMeta: { fontSize: 13, lineHeight: 18 },
  rowName: { fontWeight: '700', color: colors.textSecondary },
  rowTime: { color: colors.textSecondary },
  rowBody: { fontSize: 14, lineHeight: 20, color: colors.text, marginTop: 1 },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  deleteText: { fontSize: 12, color: colors.textSecondary },
  deleteTextConfirm: { color: colors.accent, fontWeight: '600' },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  stateTitle: { ...typography.sectionTitle, color: colors.text, textAlign: 'center' },
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
  stateButtonText: { ...typography.chip, color: colors.subscribeText },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  identityText: { ...typography.metadata, color: colors.textSecondary, flex: 1 },
  errorText: {
    ...typography.metadata,
    color: colors.accent,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  inputRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  inputPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    gap: spacing.sm,
  },
  input: { flex: 1, ...typography.body, color: colors.text, maxHeight: 100, paddingVertical: 2 },
  sendDisabled: { opacity: 0.5 },
  signInRow: { alignItems: 'center', paddingBottom: spacing.lg },
});
