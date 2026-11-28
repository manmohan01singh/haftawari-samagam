import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState, useMemo } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import type { Category, Video } from '../../../types/database';
import { isYouTubeConfigured } from '../../../lib/youtube';
import {
  addVideoFromYouTube,
  deleteVideo,
  listAllVideos,
  listCategories,
  setVideoCategory,
  setVideoPublishState,
} from '../adminService';
import { AdminGate, type AdminContext } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  Chip,
  ConfirmButton,
  ErrorBanner,
  LoadingView,
  SectionTitle,
  createAdminStyles,
  formatDuration,
  publishStateChip,
  friendlyError,
} from '../components/AdminUi';

function VideosContent({ ctx }: { ctx: AdminContext }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const adminStyles = useMemo(() => createAdminStyles(colors), [colors]);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categoryPickerFor, setCategoryPickerFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [vids, cats] = await Promise.all([listAllVideos(), listCategories()]);
      setVideos(vids);
      setCategories(cats);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const runRowAction = async (video: Video, action: () => Promise<Video | void>, done: string) => {
    setBusyId(video.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await action();
      setVideos((prev) =>
        prev == null
          ? prev
          : updated
            ? prev.map((v) => (v.id === updated.id ? updated : v))
            : prev.filter((v) => v.id !== video.id),
      );
      setNotice(done);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const onAdd = async () => {
    const input = urlInput.trim();
    if (!input || adding) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const video = await addVideoFromYouTube(input, ctx.userId);
      setVideos((prev) => [video, ...(prev ?? [])]);
      setUrlInput('');
      setNotice(`Added as draft: "${video.title}". Publish it when ready.`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setAdding(false);
    }
  };

  const categoryName = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? 'Unknown category') : 'No category';

  return (
    <AdminScroll>
      <View style={styles.addBox}>
        <SectionTitle>Add a samagam recording</SectionTitle>
        <Text style={styles.help}>
          Paste a YouTube link or video ID. The title, thumbnail and duration are fetched from
          the official YouTube Data API — the recording itself always plays in the official
          embedded player.
        </Text>
        {!isYouTubeConfigured ? (
          <ErrorBanner message="YouTube Data API is not configured (no API key set), so metadata cannot be fetched." />
        ) : null}
        <TextInput
          style={adminStyles.input}
          value={urlInput}
          onChangeText={setUrlInput}
          placeholder="https://www.youtube.com/watch?v=…"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <AdminButton
          title={adding ? 'Fetching from YouTube…' : 'Fetch & add as draft'}
          variant="primary"
          disabled={adding || !urlInput.trim() || !isYouTubeConfigured}
          onPress={onAdd}
        />
      </View>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.listHeader}>
        <SectionTitle>Library ({videos?.length ?? 0})</SectionTitle>
        <AdminButton title="Refresh" onPress={load} />
      </View>

      {videos == null ? (
        <LoadingView label="Loading videos…" />
      ) : videos.length === 0 ? (
        <EmptyState
          title="No recordings yet"
          message="Add the first samagam above. Drafts stay hidden from the public feed until you publish them."
        />
      ) : (
        videos.map((video) => {
          const chip = publishStateChip(video.publish_state);
          const busy = busyId === video.id;
          return (
            <View key={video.id} style={styles.card}>
              <View style={styles.cardTop}>
                {video.thumbnail_url ? (
                  <Image source={{ uri: video.thumbnail_url }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]} />
                )}
                <View style={styles.cardText}>
                  <Text style={styles.title} numberOfLines={2}>
                    {video.title}
                  </Text>
                  <Text style={styles.meta}>
                    {formatDuration(video.duration_seconds)} · {categoryName(video.category_id)}
                  </Text>
                  <Text style={styles.metaSmall}>YouTube ID: {video.youtube_video_id}</Text>
                  <Chip label={chip.label} tone={chip.tone} />
                </View>
              </View>

              <View style={styles.actions}>
                {video.publish_state === 'published' ? (
                  <AdminButton
                    title="Unpublish"
                    disabled={busy}
                    onPress={() =>
                      runRowAction(
                        video,
                        () => setVideoPublishState(video, 'unpublished', ctx.userId),
                        `Unpublished: "${video.title}"`,
                      )
                    }
                  />
                ) : (
                  <AdminButton
                    title="Publish"
                    variant="primary"
                    disabled={busy}
                    onPress={() =>
                      runRowAction(
                        video,
                        () => setVideoPublishState(video, 'published', ctx.userId),
                        `Published: "${video.title}"`,
                      )
                    }
                  />
                )}
                <AdminButton
                  title="Category"
                  disabled={busy}
                  onPress={() =>
                    setCategoryPickerFor((cur) => (cur === video.id ? null : video.id))
                  }
                />
                <ConfirmButton
                  title="Delete"
                  confirmTitle="Tap again to delete"
                  disabled={busy}
                  onConfirm={() =>
                    runRowAction(
                      video,
                      () => deleteVideo(video, ctx.userId),
                      `Deleted: "${video.title}"`,
                    )
                  }
                />
              </View>

              {categoryPickerFor === video.id ? (
                <View style={styles.picker}>
                  <Text style={styles.pickerLabel}>Set category:</Text>
                  <View style={styles.pickerOptions}>
                    {[null, ...categories.map((c) => c.id)].map((id) => {
                      const label = id == null ? 'No category' : categoryName(id);
                      const selected = video.category_id === id;
                      return (
                        <AdminButton
                          key={id ?? 'none'}
                          title={selected ? `✓ ${label}` : label}
                          variant={selected ? 'primary' : 'secondary'}
                          disabled={busy}
                          onPress={() => {
                            setCategoryPickerFor(null);
                            void runRowAction(
                              video,
                              () => setVideoCategory(video, id, id == null ? null : label, ctx.userId),
                              `Category set to ${label}: "${video.title}"`,
                            );
                          }}
                        />
                      );
                    })}
                  </View>
                  {categories.length === 0 ? (
                    <Text style={styles.meta}>
                      No categories exist yet — create them on the Categories screen.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </AdminScroll>
  );
}

/** Admin — Videos: add real samagams via the YouTube API, publish/unpublish, categorise, delete. */
export function AdminVideosScreen() {
  return <AdminGate>{(ctx) => <VideosContent ctx={ctx} />}</AdminGate>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  addBox: { gap: spacing.md },
  help: { ...typography.body, color: colors.textSecondary },
  notice: { ...typography.body, color: '#1B5E20' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  cardTop: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 120, height: 68, borderRadius: radii.badge, backgroundColor: '#000' },
  thumbEmpty: { backgroundColor: colors.surfaceVariant },
  cardText: { flex: 1, gap: spacing.xs },
  title: { ...typography.cardTitle, color: colors.text },
  meta: { ...typography.metadata, color: colors.textSecondary },
  metaSmall: { ...typography.metadata, color: colors.textSecondary, fontSize: 11 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  picker: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  pickerLabel: { ...typography.chip, color: colors.text },
  pickerOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
