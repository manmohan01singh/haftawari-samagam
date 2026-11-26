import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { lightColors, radii, spacing, typography } from '../../../theme';
import type { AuditLog, Profile } from '../../../types/database';
import { fetchProfilesByIds, listAuditLogs } from '../adminService';
import { AdminGate } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  ErrorBanner,
  LoadingView,
  SectionTitle,
  formatDateTime,
  friendlyError,
} from '../components/AdminUi';

function detailsSummary(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  const parts = Object.entries(details)
    .filter(([, v]) => v != null && v !== '')
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function AuditLogsContent() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [actors, setActors] = useState<Map<string, Profile>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await listAuditLogs(100);
      setLogs(rows);
      const ids = [...new Set(rows.map((l) => l.actor_id).filter((x): x is string => !!x))];
      setActors(await fetchProfilesByIds(ids));
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
      <Text style={styles.help}>
        Read-only. Every admin action taken in this dashboard — adding, publishing or deleting
        videos, scheduling or cancelling sessions, category changes and chat moderation — is
        appended here with the acting admin. Entries cannot be edited or deleted from the app.
      </Text>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}

      <View style={styles.listHeader}>
        <SectionTitle>Latest activity ({logs?.length ?? 0})</SectionTitle>
        <AdminButton title="Refresh" onPress={load} />
      </View>

      {logs == null ? (
        <LoadingView label="Loading audit logs…" />
      ) : logs.length === 0 ? (
        <EmptyState
          title="No admin actions recorded yet"
          message="The log fills as admins work — the first video added or session scheduled will appear here."
        />
      ) : (
        logs.map((log) => {
          const actor = log.actor_id ? actors.get(log.actor_id) : undefined;
          const summary = detailsSummary(log.details);
          return (
            <View key={log.id} style={styles.card}>
              <Text style={styles.action}>{log.action}</Text>
              <Text style={styles.meta}>
                {actor?.display_name ?? (log.actor_id ? 'Admin' : 'System')}
                {log.entity_type ? ` · ${log.entity_type}` : ''}
                {log.entity_id ? ` · ${log.entity_id.slice(0, 8)}…` : ''}
              </Text>
              {summary ? <Text style={styles.details}>{summary}</Text> : null}
              <Text style={styles.meta}>{formatDateTime(log.created_at)}</Text>
            </View>
          );
        })
      )}
    </AdminScroll>
  );
}

/** Admin — Audit logs: append-only record of admin actions (read-only here). */
export function AdminAuditLogsScreen() {
  return <AdminGate>{() => <AuditLogsContent />}</AdminGate>;
}

const styles = StyleSheet.create({
  help: { ...typography.body, color: lightColors.textSecondary },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: lightColors.surface,
  },
  action: { ...typography.chip, color: lightColors.text },
  meta: { ...typography.metadata, color: lightColors.textSecondary },
  details: { ...typography.body, color: lightColors.textSecondary },
});
