import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors, nativeApp, radii, spacing } from '../../../theme';

interface CreatePlaylistSheetProps {
  visible: boolean;
  /** Creates the playlist; resolve with nothing, throw with a message on failure. */
  onCreate: (title: string, isPublic: boolean) => Promise<void>;
  onClose: () => void;
}

/**
 * Bottom-sheet form for creating a playlist: title + visibility
 * (Public / Private radio rows, matching the playlists.is_public flag).
 * Resets itself every time it opens.
 */
export function CreatePlaylistSheet({ visible, onCreate, onClose }: CreatePlaylistSheetProps) {
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setIsPublic(true);
    setBusy(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed, isPublic);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the playlist.');
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.handle} />
            <Text style={styles.heading}>New playlist</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Playlist title"
              placeholderTextColor={lightColors.textSecondary}
              maxLength={120}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <Pressable style={styles.radioRow} onPress={() => setIsPublic(true)} accessibilityRole="radio" accessibilityState={{ selected: isPublic }}>
              <MaterialIcons
                name={isPublic ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={22}
                color={lightColors.text}
              />
              <MaterialIcons name="public" size={20} color={lightColors.textSecondary} />
              <View style={styles.radioLines}>
                <Text style={styles.radioTitle}>Public</Text>
                <Text style={styles.radioMeta}>Anyone can see this playlist</Text>
              </View>
            </Pressable>
            <Pressable style={styles.radioRow} onPress={() => setIsPublic(false)} accessibilityRole="radio" accessibilityState={{ selected: !isPublic }}>
              <MaterialIcons
                name={!isPublic ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={22}
                color={lightColors.text}
              />
              <MaterialIcons name="lock" size={20} color={lightColors.textSecondary} />
              <View style={styles.radioLines}>
                <Text style={styles.radioTitle}>Private</Text>
                <Text style={styles.radioMeta}>Only you can see this playlist</Text>
              </View>
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.cancelButton} onPress={handleClose} disabled={busy} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.createButton, (!title.trim() || busy) && styles.disabled]}
                onPress={handleCreate}
                disabled={!title.trim() || busy}
                accessibilityRole="button"
              >
                <Text style={styles.createText}>{busy ? 'Creating…' : 'Create'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: lightColors.surface,
    borderTopLeftRadius: nativeApp.watchSheet.topRadius,
    borderTopRightRadius: nativeApp.watchSheet.topRadius,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: nativeApp.watchSheet.dragHandleWidth,
    height: nativeApp.watchSheet.dragHandleHeight,
    borderRadius: radii.pill,
    backgroundColor: lightColors.border,
    marginBottom: spacing.lg,
  },
  heading: { fontSize: 18, fontWeight: '700', color: lightColors.text, marginBottom: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 16,
    color: lightColors.text,
    marginBottom: spacing.md,
  },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  radioLines: { flex: 1 },
  radioTitle: { fontSize: 15, fontWeight: '500', color: lightColors.text },
  radioMeta: { fontSize: 13, color: lightColors.textSecondary, marginTop: 1 },
  error: { color: lightColors.accent, fontSize: 13, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  cancelButton: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: lightColors.surfaceVariant,
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: lightColors.text },
  createButton: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: lightColors.subscribeBackground,
  },
  createText: { fontSize: 14, fontWeight: '600', color: lightColors.subscribeText },
  disabled: { opacity: 0.5 },
});
