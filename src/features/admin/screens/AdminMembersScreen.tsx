import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import type { Profile } from '../../../types/database';
import { listMembers } from '../adminService';
import { AdminGate } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  Chip,
  ErrorBanner,
  LoadingView,
  SectionTitle,
  formatDateTime,
  roleChip,
  friendlyError,
} from '../components/AdminUi';

function MembersContent() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [members, setMembers] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMembers(await listMembers());
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <AdminScroll>
      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>About roles</Text>
        <Text style={styles.note}>
          Roles come from the profiles table and are shown exactly as stored. For safety,
          roles are NOT changed inside the app — the database itself blocks role changes by
          non-admins, and promotion is a deliberate act by the project owner in the Supabase
          dashboard SQL editor:
        </Text>
        <Text style={styles.sql}>
          {"update profiles set role = 'admin' where id = '<member id>';"}
        </Text>
        <Text style={styles.note}>
          {'The id of each member is shown under their name so the owner can run that command ' +
            'for the right person. There is deliberately no "make admin" button here — a ' +
            'control that the database would reject would be a fake control.'}
        </Text>
      </View>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}

      <View style={styles.listHeader}>
        <SectionTitle>Members ({members?.length ?? 0})</SectionTitle>
        <AdminButton title="Refresh" onPress={load} />
      </View>

      {members == null ? (
        <LoadingView label="Loading members…" />
      ) : members.length === 0 ? (
        <EmptyState
          title="No members yet"
          message="Profiles appear here as people sign up. New accounts always start as members."
        />
      ) : (
        members.map((member) => {
          const chip = roleChip(member.role);
          return (
            <View key={member.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>{member.display_name ?? '(no display name)'}</Text>
                <Chip label={chip.label} tone={chip.tone} />
              </View>
              <Text style={styles.meta}>Joined {formatDateTime(member.created_at)}</Text>
              <Text style={styles.idText}>id: {member.id}</Text>
            </View>
          );
        })
      )}
    </AdminScroll>
  );
}

/** Admin — Members: real profile list with roles; promotion stays a documented SQL act. */
export function AdminMembersScreen() {
  return <AdminGate>{() => <MembersContent />}</AdminGate>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  noteBox: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noteTitle: { ...typography.chip, color: colors.text },
  note: { ...typography.body, color: colors.textSecondary },
  sql: {
    ...typography.body,
    color: colors.text,
    fontFamily: 'monospace',
    backgroundColor: colors.surface,
    borderRadius: radii.badge,
    padding: spacing.sm,
  },
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
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  name: { ...typography.cardTitle, color: colors.text, flex: 1 },
  meta: { ...typography.metadata, color: colors.textSecondary },
  idText: {
    ...typography.metadata,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
  },
});
