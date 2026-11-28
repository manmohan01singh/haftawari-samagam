import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface RequireAuthSheetProps {
  /** The action the guest tried, in words: "like this samagam". */
  action: string | null;
  onSignIn: () => void;
  onDismiss: () => void;
}

/**
 * The guest gate, in place (Chat 2 fault 14, 28 Nov 2026): a guest
 * who taps Like / Save / Comment is NEVER thrown off the page to a
 * full-screen sign-in. This sheet opens over the content — the
 * video keeps its place behind it — explains in one line why an
 * account helps, and offers Sign in (their choice) or Not now
 * (stay, lose nothing).
 */
export function RequireAuthSheet({ action, onSignIn, onDismiss }: RequireAuthSheetProps) {
  const { colors } = useTheme();
  if (action == null) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss">
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surface }]}
          onPress={() => undefined}
        >
          <Text style={[styles.title, { color: colors.text }]}>Sign in to {action}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Signing in keeps your likes, saves and comments with the sangat, on every device.
            You can keep watching as a guest — nothing here will stop.
          </Text>
          <Pressable
            style={[styles.primary, { backgroundColor: colors.accent }]}
            onPress={onSignIn}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Sign in</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={onDismiss} accessibilityRole="button">
            <Text style={[styles.ghostText, { color: colors.text }]}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 30,
    gap: 10,
  },
  title: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20 },
  primary: {
    marginTop: 8,
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  ghost: { paddingVertical: 10, alignItems: 'center' },
  ghostText: { fontSize: 15, fontWeight: '500' },
});
