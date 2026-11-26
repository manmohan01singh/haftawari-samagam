import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { lightColors, radii, spacing } from '../../../theme';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app confirmation dialog (RN's Alert is a no-op on web, so the
 * destructive "clear all history" flow uses this instead — identical
 * behaviour on Android, iOS and the PWA).
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      {/* While an action is busy the backdrop must not dismiss the
          dialog: tapping outside used to close it mid-clear, leaving
          the destructive action running with no visible feedback. */}
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable style={styles.cancelButton} onPress={onCancel} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmButton, busy && styles.disabled]}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={styles.confirmText}>{busy ? 'Working…' : confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: lightColors.surface,
    borderRadius: radii.banner,
    padding: spacing.xl,
  },
  title: { fontSize: 18, fontWeight: '700', color: lightColors.text },
  message: { fontSize: 14, lineHeight: 20, color: lightColors.textSecondary, marginTop: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl },
  cancelButton: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: lightColors.surfaceVariant,
  },
  cancelText: { fontSize: 14, fontWeight: '600', color: lightColors.text },
  confirmButton: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: lightColors.accent,
  },
  confirmText: { fontSize: 14, fontWeight: '600', color: lightColors.onAccent },
  disabled: { opacity: 0.6 },
});
