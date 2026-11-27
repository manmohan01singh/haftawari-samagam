import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { nativeApp, radii, spacing, useTheme, type ThemeColors } from '../../../theme';
import {
  addVideoToPlaylist,
  createPlaylist,
  fetchPlaylistsForVideo,
  removePlaylistItem,
} from '../libraryService';
import type { PlaylistMembership } from '../types';
import { CreatePlaylistSheet } from './CreatePlaylistSheet';
import { ROW_LIST_PERF } from '../../../lib/listPerf';

interface AddToPlaylistSheetProps {
  visible: boolean;
  /** Owner of the playlists (the signed-in user). Null hides the sheet. */
  userId: string | null;
  /** The Supabase `videos` row id to add/remove. */
  videoId: string | null;
  onClose: () => void;
  /** Called after any membership change so callers can refresh. */
  onChanged?: () => void;
}

/**
 * "Save to playlist" bottom sheet, reusable from any video surface
 * (watch page, feed card menu, …). Lists the user's OWN playlists with
 * a filled checkbox where the recording already lives; tapping toggles
 * membership against the live backend. "New playlist" creates one and
 * adds the recording to it in the same flow.
 */
export function AddToPlaylistSheet({ visible, userId, videoId, onClose, onChanged }: AddToPlaylistSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [rows, setRows] = useState<PlaylistMembership[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    if (!userId || !videoId) return;
    setLoading(true);
    setError(null);
    fetchPlaylistsForVideo(userId, videoId)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your playlists.'))
      .finally(() => setLoading(false));
  }, [userId, videoId]);

  useEffect(() => {
    if (!visible) return;
    // Deferred one tick: load()'s setState must not run synchronously
    // inside the effect (react-hooks rule).
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [visible, load]);

  const toggle = async (row: PlaylistMembership) => {
    if (!videoId || busyId) return;
    setBusyId(row.playlist.id);
    setError(null);
    try {
      if (row.containsVideo) await removePlaylistItem(row.playlist.id, videoId);
      else await addVideoToPlaylist(row.playlist.id, videoId);
      setRows((prev) =>
        prev.map((r) =>
          r.playlist.id === row.playlist.id
            ? {
                ...r,
                containsVideo: !r.containsVideo,
                itemCount: r.itemCount + (r.containsVideo ? -1 : 1),
              }
            : r,
        ),
      );
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the playlist.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (title: string, isPublic: boolean) => {
    if (!userId || !videoId) throw new Error('Sign in to create a playlist.');
    const playlist = await createPlaylist(userId, title, isPublic);
    try {
      await addVideoToPlaylist(playlist.id, videoId);
    } catch (e) {
      // The playlist now EXISTS. Throwing here would keep the create
      // sheet open, and a retry would create a duplicate playlist.
      // Instead: close the create sheet (resolve), show the new
      // playlist unchecked in this sheet, and surface the add error
      // here where the user can simply tap the checkbox to retry.
      setRows((prev) => [{ playlist, itemCount: 0, containsVideo: false }, ...prev]);
      setError(
        e instanceof Error
          ? `Playlist created, but the recording could not be added: ${e.message}`
          : 'Playlist created, but the recording could not be added.',
      );
      return;
    }
    setRows((prev) => [{ playlist, itemCount: 1, containsVideo: true }, ...prev]);
    onChanged?.();
  };

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Save to playlist</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <MaterialIcons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          {!userId || !videoId ? (
            // Honest signed-out state: previously this fell through to
            // "You have no playlists yet" and a New-playlist flow that
            // could only fail with a sign-in error.
            <Text style={styles.emptyText}>
              Sign in to save recordings to your playlists.
            </Text>
          ) : (
            <>
          <Pressable style={styles.newRow} onPress={() => setCreateOpen(true)} accessibilityRole="button">
            <MaterialIcons name="add" size={24} color={colors.text} />
            <Text style={styles.newText}>New playlist</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {loading ? (
            <View style={styles.loadingBox} accessibilityLabel="Loading your playlists">
              <View style={styles.skeletonRow} />
              <View style={styles.skeletonRow} />
              <View style={styles.skeletonRow} />
            </View>
          ) : rows.length === 0 ? (
            <Text style={styles.emptyText}>You have no playlists yet. Create one above.</Text>
          ) : (
            <FlatList
              {...ROW_LIST_PERF}
              data={rows}
              keyExtractor={(r) => r.playlist.id}
              style={styles.list}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.row}
                  onPress={() => toggle(item)}
                  disabled={busyId === item.playlist.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: item.containsVideo }}
                >
                  <MaterialIcons
                    name={item.containsVideo ? 'check-box' : 'check-box-outline-blank'}
                    size={24}
                    color={colors.text}
                  />
                  <View style={styles.rowLines}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.playlist.title}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {item.playlist.is_public ? 'Public' : 'Private'} · {item.itemCount}{' '}
                      {item.itemCount === 1 ? 'recording' : 'recordings'}
                    </Text>
                  </View>
                  {busyId === item.playlist.id ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : item.playlist.is_public ? null : (
                    <MaterialIcons name="lock" size={16} color={colors.textSecondary} />
                  )}
                </Pressable>
              )}
            />
          )}
            </>
          )}
        </View>
      </View>
    </Modal>
    <CreatePlaylistSheet
      visible={createOpen}
      onCreate={handleCreate}
      onClose={() => setCreateOpen(false)}
    />
    </>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    zIndex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.sm,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: nativeApp.watchSheet.dragHandleWidth,
    height: nativeApp.watchSheet.dragHandleHeight,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  newText: { fontSize: 15, fontWeight: '500', color: colors.text },
  error: { color: colors.accent, fontSize: 13, marginTop: spacing.sm },
  loadingBox: { paddingVertical: spacing.lg, gap: spacing.md },
  skeletonRow: {
    height: 44,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceVariant,
  },
  emptyText: { fontSize: 14, color: colors.textSecondary, paddingVertical: spacing.lg },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowLines: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
  rowMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
});
