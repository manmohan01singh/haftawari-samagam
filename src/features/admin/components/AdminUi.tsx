import React, { useEffect, useState, useMemo, type ReactNode } from 'react';
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
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import type { PublishState, SessionStatus, UserRole } from '../../../types/database';

/**
 * Turn a raw backend error into a short human message. Supabase /
 * PostgREST errors carry codes and constraint names that mean nothing
 * to an admin at the point of failure (and can read like JSON); map the
 * recognisable cases and fall back to a plain retry message. The raw
 * error is never shown verbatim.
 */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();
  if (lower.includes('42501') || lower.includes('permission') || lower.includes('row-level security')) {
    return 'You do not have permission to do this. Make sure you are signed in as an admin.';
  }
  if (lower.includes('duplicate key') || lower.includes('23505') || lower.includes('already exists')) {
    return 'That already exists — try a different name or value.';
  }
  if (lower.includes('fetch') || lower.includes('network') || lower.includes('timeout')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (lower.includes('jwt') || lower.includes('not authenticated') || lower.includes('session')) {
    return 'Your sign-in session has expired. Sign in again and retry.';
  }
  if (lower.includes('invalid input syntax')) {
    return 'One of the values is not in the expected format. Check the fields and try again.';
  }
  if (raw.length > 0 && raw.length <= 140 && !raw.includes('{') && !raw.includes('code:')) {
    return raw;
  }
  return 'Something went wrong. Please try again.';
}

/** Shared building blocks for the admin dashboard screens. */

export function AdminScroll({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {children}
    </ScrollView>
  );
}

export function LoadingView({ label }: { label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.text} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function StatCard({ label, value }: { label: string; value: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  // An armed button disarms itself after a few seconds: without this a
  // first tap in the morning left the button primed, so a later single
  // tap deleted/cancelled with no real confirmation.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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

export const createAdminStyles = (colors: ThemeColors) => StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  fieldLabel: {
    ...typography.metadata,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, width: '100%', maxWidth: 960, alignSelf: 'center' },
  screenContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  muted: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  errorBox: {
    backgroundColor: '#FDECEC',
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  errorText: { ...typography.body, color: '#8B0000' },
  retryButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  retryText: { ...typography.chip, color: '#8B0000', textDecorationLine: 'underline' },
  sectionTitle: { ...typography.sectionTitle, color: colors.text },
  statCard: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statValue: { fontSize: 24, lineHeight: 30, fontWeight: '700', color: colors.text },
  statLabel: { ...typography.metadata, color: colors.textSecondary },
  button: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
  },
  buttonPrimary: { backgroundColor: colors.subscribeBackground },
  buttonDanger: { backgroundColor: '#FDECEC' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...typography.chip, color: colors.text },
  buttonTextPrimary: { color: colors.subscribeText },
  buttonTextDanger: { color: '#8B0000' },
  chip: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.surfaceVariant,
    alignSelf: 'flex-start',
  },
  chipDark: { backgroundColor: colors.subscribeBackground },
  chipAccent: { backgroundColor: colors.accent },
  chipOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: colors.text },
  chipTextLight: { color: '#FFFFFF' },
});
