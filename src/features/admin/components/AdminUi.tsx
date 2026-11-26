import React, { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { lightColors, radii, spacing, typography } from '../../../theme';
import type { PublishState, SessionStatus, UserRole } from '../../../types/database';

/** Shared building blocks for the admin dashboard screens. */

export function AdminScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

export function LoadingView({ label }: { label: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={lightColors.text} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function AdminButton({
  title,
  onPress,
  variant = 'secondary',
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'primary' && styles.buttonTextPrimary,
          variant === 'danger' && styles.buttonTextDanger,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * Two-step destructive action: first tap arms the button ("Confirm?"),
 * second tap executes. Used instead of Alert.alert so confirmation
 * behaves identically on Android, iOS and the PWA.
 */
export function ConfirmButton({
  title,
  confirmTitle = 'Confirm?',
  onConfirm,
  disabled = false,
}: {
  title: string;
  confirmTitle?: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <AdminButton
      title={armed ? confirmTitle : title}
      variant="danger"
      disabled={disabled}
      onPress={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    />
  );
}

export function Chip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'dark' | 'accent' | 'outline';
}) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'dark' && styles.chipDark,
        tone === 'accent' && styles.chipAccent,
        tone === 'outline' && styles.chipOutline,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          (tone === 'dark' || tone === 'accent') && styles.chipTextLight,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

export function publishStateChip(state: PublishState): { label: string; tone: 'dark' | 'neutral' | 'outline' } {
  switch (state) {
    case 'published':
      return { label: 'PUBLISHED', tone: 'dark' };
    case 'unpublished':
      return { label: 'UNPUBLISHED', tone: 'outline' };
    default:
      return { label: 'DRAFT', tone: 'neutral' };
  }
}

/** The ONLY status labels a session may show (truthfulness rule). */
export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  upcoming: 'UPCOMING',
  now_playing: 'NOW PLAYING',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

export function sessionStatusTone(status: SessionStatus): 'accent' | 'dark' | 'neutral' | 'outline' {
  switch (status) {
    case 'now_playing':
      return 'accent';
    case 'upcoming':
      return 'dark';
    case 'completed':
      return 'neutral';
    default:
      return 'outline';
  }
}

export function roleChip(role: UserRole): { label: string; tone: 'dark' | 'neutral' } {
  return role === 'admin' ? { label: 'ADMIN', tone: 'dark' } : { label: 'MEMBER', tone: 'neutral' };
}

// ── Formatting helpers (real values only) ────────────────────────────

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null) return '—';
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const adminStyles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
    color: lightColors.text,
    backgroundColor: lightColors.surface,
  },
  fieldLabel: {
    ...typography.metadata,
    color: lightColors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: lightColors.background },
  screenContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: lightColors.background,
    padding: spacing.xl,
  },
  muted: { ...typography.body, color: lightColors.textSecondary, textAlign: 'center' },
  errorBox: {
    backgroundColor: '#FDECEC',
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorText: { ...typography.body, color: '#8B0000' },
  retryButton: { alignSelf: 'flex-start' },
  retryText: { ...typography.chip, color: '#8B0000', textDecorationLine: 'underline' },
  sectionTitle: { ...typography.sectionTitle, color: lightColors.text },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statValue: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: lightColors.text },
  statLabel: { ...typography.metadata, color: lightColors.textSecondary },
  button: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: lightColors.surfaceVariant,
    alignItems: 'center',
  },
  buttonPrimary: { backgroundColor: lightColors.subscribeBackground },
  buttonDanger: { backgroundColor: '#FDECEC' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...typography.chip, color: lightColors.text },
  buttonTextPrimary: { color: lightColors.subscribeText },
  buttonTextDanger: { color: '#8B0000' },
  chip: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: lightColors.surfaceVariant,
    alignSelf: 'flex-start',
  },
  chipDark: { backgroundColor: lightColors.subscribeBackground },
  chipAccent: { backgroundColor: lightColors.accent },
  chipOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: lightColors.border,
  },
  chipText: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: lightColors.text },
  chipTextLight: { color: '#FFFFFF' },
});
