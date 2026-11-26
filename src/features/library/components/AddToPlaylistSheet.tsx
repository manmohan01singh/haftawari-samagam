import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors, nativeApp, radii, spacing } from '../../../theme';
import {
  addVideoToPlaylist,
  createPlaylist,
  fetchPlaylistsForVideo,
  removePlaylistItem,
} from '../libraryService';
import type { PlaylistMembership } from '../types';
import { CreatePlaylistSheet } from './CreatePlaylistSheet';

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
    await addVideoToPlaylist(playlist.id, videoId);
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
              <MaterialIcons name="close" size={24} color={lightColors.text} />
            </Pressable>
          </View>

          <Pressable style={styles.newRow} onPress={() => setCreateOpen(true)} accessibilityRole="button">
            <MaterialIcons name="add" size={24} color={lightColors.text} />
            <Text style={styles.newText}>New playlist</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={lightColors.text} />
            </View>
          ) : rows.length === 0 ? (
            <Text style={styles.emptyText}>You have no playlists yet. Create one above.</Text>
          ) : (
            <FlatList
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
                    color={lightColors.text}
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
                    <ActivityIndicator size="small" color={lightColors.textSecondary} />
                  ) : item.playlist.is_public ? null : (
                    <MaterialIcons name="lock" size={16} color={lightColors.textSecondary} />
                  )}
                </Pressable>
              )}
            />
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    zIndex: 1,
    backgroundColor: lightColors.surface,
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
    backgroundColor: lightColors.border,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '700', color: lightColors.text },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: lightColors.border,
  },
  newText: { fontSize: 15, fontWeight: '500', color: lightColors.text },
  error: { color: lightColors.accent, fontSize: 13, marginTop: spacing.sm },
  loadingBox: { paddingVertical: spacing.xxl, alignItems: 'center' },
  emptyText: { fontSize: 14, color: lightColors.textSecondary, paddingVertical: spacing.lg },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowLines: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '500', color: lightColors.text },
  rowMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 1 },
});
