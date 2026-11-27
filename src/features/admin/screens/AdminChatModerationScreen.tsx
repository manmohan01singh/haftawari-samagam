import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import type { ChatMessage, Profile } from '../../../types/database';
import {
  fetchProfilesByIds,
  listChatMessages,
  listSessionsWithVideo,
  setChatMessageRemoved,
  type SessionWithVideo,
} from '../adminService';
import { AdminGate, type AdminContext } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  Chip,
  ConfirmButton,
  ErrorBanner,
  LoadingView,
  SESSION_STATUS_LABEL,
  SectionTitle,
  formatDateTime,
  sessionStatusTone,
  friendlyError,
} from '../components/AdminUi';

function ModerationContent({ ctx }: { ctx: AdminContext }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [sessions, setSessions] = useState<SessionWithVideo[] | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [authors, setAuthors] = useState<Map<string, Profile>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadMessages = useCallback(async (sessionId: string) => {
    setMessages(null);
    try {
      const rows = await listChatMessages(sessionId);
      setMessages(rows);
      const ids = [...new Set(rows.map((m) => m.user_id))];
      setAuthors(await fetchProfilesByIds(ids));
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setError(null);
    try {
      const rows = await listSessionsWithVideo();
      setSessions(rows);
      if (rows.length > 0) {
        setSelectedSessionId((current) => {
          const next = current && rows.some((s) => s.id === current) ? current : rows[0].id;
          void loadMessages(next);
          return next;
        });
      }
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [loadMessages]);

  useFocusEffect(
    useCallback(() => {
      void loadSessions();
    }, [loadSessions]),
  );

  const onSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setNotice(null);
    setError(null);
    void loadMessages(sessionId);
  };

  const onToggleRemoved = async (message: ChatMessage) => {
    setBusyId(message.id);
    setError(null);
    setNotice(null);
    try {
      await setChatMessageRemoved(message, !message.is_removed, ctx.userId);
      setMessages((prev) =>
        (prev ?? []).map((m) =>
          m.id === message.id ? { ...m, is_removed: !message.is_removed } : m,
        ),
      );
      setNotice(message.is_removed ? 'Message restored.' : 'Message removed from chat.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const authorName = (userId: string) =>
    authors.get(userId)?.display_name ?? 'Member';

  return (
    <AdminScroll>
      <SectionTitle>Choose a session</SectionTitle>
      {sessions == null ? (
        <LoadingView label="Loading sessions…" />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          message="Chat exists only inside scheduled sessions. Schedule one on the Sessions screen first."
        />
      ) : (
        <View style={styles.sessionOptions}>
          {sessions.map((s) => (
            <View key={s.id} style={styles.sessionOption}>
              <AdminButton
                title={s.title ?? s.video?.title ?? 'Untitled session'}
                variant={selectedSessionId === s.id ? 'primary' : 'secondary'}
                onPress={() => onSelectSession(s.id)}
              />
              <Chip
                label={SESSION_STATUS_LABEL[s.status]}
                tone={sessionStatusTone(s.status)}
              />
            </View>
          ))}
        </View>
      )}

      {error ? (
        <ErrorBanner message={error} onRetry={selectedSessionId ? () => void loadMessages(selectedSessionId) : loadSessions} />
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {selectedSessionId ? (
        <>
          <View style={styles.listHeader}>
            <SectionTitle>Messages ({messages?.length ?? 0})</SectionTitle>
            <AdminButton title="Refresh" onPress={() => void loadMessages(selectedSessionId)} />
          </View>
          <Text style={styles.help}>
            Newest first, latest 100. Removed messages stay visible here (marked REMOVED) so
            moderation is auditable, but members no longer see them.
          </Text>
          {messages == null ? (
            <LoadingView label="Loading messages…" />
          ) : messages.length === 0 ? (
            <EmptyState
              title="No chat messages"
              message="Nobody has chatted in this session yet. Nothing is seeded or simulated — this list only ever shows real member messages."
            />
          ) : (
            messages.map((message) => (
              <View
                key={message.id}
                style={[styles.card, message.is_removed && styles.cardRemoved]}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.author}>{authorName(message.user_id)}</Text>
                  {message.is_removed ? <Chip label="REMOVED" tone="accent" /> : null}
                </View>
                <Text style={styles.body}>{message.body}</Text>
                <Text style={styles.meta}>{formatDateTime(message.created_at)}</Text>
                <View style={styles.actions}>
                  {message.is_removed ? (
                    <AdminButton
                      title="Restore"
                      disabled={busyId === message.id}
                      onPress={() => void onToggleRemoved(message)}
                    />
                  ) : (
                    <ConfirmButton
                      title="Remove"
                      confirmTitle="Tap again to remove"
                      disabled={busyId === message.id}
                      onConfirm={() => void onToggleRemoved(message)}
                    />
                  )}
                </View>
              </View>
            ))
          )}
        </>
      ) : null}
    </AdminScroll>
  );
}

/** Admin — Chat moderation: review a session's real chat and remove/restore messages. */
export function AdminChatModerationScreen() {
  return <AdminGate>{(ctx) => <ModerationContent ctx={ctx} />}</AdminGate>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  sessionOptions: { gap: spacing.sm },
  sessionOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  notice: { ...typography.body, color: '#1B5E20' },
  help: { ...typography.body, color: colors.textSecondary },
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
  cardRemoved: { opacity: 0.65, borderStyle: 'dashed' },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  author: { ...typography.chip, color: colors.text, flex: 1 },
  body: { ...typography.body, color: colors.text },
  meta: { ...typography.metadata, color: colors.textSecondary },
  actions: { flexDirection: 'row', marginTop: spacing.xs },
});
