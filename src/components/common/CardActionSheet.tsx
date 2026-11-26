import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { lightColors, nativeApp, radii, spacing } from '../../theme';

export interface CardMenuAction {
  key: string;
  label: string;
  /** MaterialIcons glyph name. */
  icon: string;
  onPress: () => void;
}

interface CardActionSheetProps {
  visible: boolean;
  onClose: () => void;
  actions: CardMenuAction[];
}

/**
 * Bottom action sheet behind card ⋮ (kebab) buttons (QA issue 31).
 * Only actions the caller can really perform are listed — the sheet
 * itself invents nothing. Backdrop is a SIBLING absolute fill (never a
 * Pressable wrapping the sheet — that pattern swallowed taps on web).
 */
export function CardActionSheet({ visible, onClose, actions }: CardActionSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={styles.row}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              accessibilityRole="button"
            >
              <MaterialIcons
                name={action.icon as keyof typeof MaterialIcons.glyphMap}
                size={24}
                color={lightColors.text}
              />
              <Text style={styles.label}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.row} onPress={onClose} accessibilityRole="button">
            <MaterialIcons name="close" size={24} color={lightColors.text} />
            <Text style={styles.label}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  },
  handle: {
    alignSelf: 'center',
    width: nativeApp.watchSheet.dragHandleWidth,
    height: nativeApp.watchSheet.dragHandleHeight,
    borderRadius: radii.pill,
    backgroundColor: lightColors.border,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 52,
    paddingVertical: spacing.md,
  },
  label: { fontSize: 15, fontWeight: '500', color: lightColors.text },
});
