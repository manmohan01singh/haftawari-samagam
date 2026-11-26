import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { lightColors, spacing, typography } from '../../../theme';
import type { SessionStatus, Video } from '../../../types/database';
import {
  cancelSession,
  createSession,
  listPublishedVideos,
  listSessionsWithVideo,
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
  adminStyles,
  formatDateTime,
  sessionStatusTone,
} from '../components/AdminUi';

const STATUS_ORDER: SessionStatus[] = ['now_playing', 'upcoming', 'completed', 'cancelled'];

function todayLocalDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Combine a YYYY-MM-DD date and HH:MM time (device-local) into an ISO string. */
function toIso(dateStr: string, timeStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function SessionsContent({ ctx }: { ctx: AdminContext }) {
  const [sessions, setSessions] = useState<SessionWithVideo[] | null>(null);
  const [publishedVideos, setPublishedVideos] = useState<Video[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create-form state
  const [videoId, setVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(todayLocalDate());
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sess, pubs] = await Promise.all([listSessionsWithVideo(), listPublishedVideos()]);
      setSessions(sess);
      setPublishedVideos(pubs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const grouped = useMemo(() => {
    const map = new Map<SessionStatus, SessionWithVideo[]>();
    for (const status of STATUS_ORDER) map.set(status, []);
    for (const s of sessions ?? []) map.get(s.status)?.push(s);
    return map;
  }, [sessions]);

  const onCreate = async () => {
    setFormError(null);
    setNotice(null);
    if (!videoId) {
      setFormError('Choose a published video first.');
      return;
    }
    const startIso = toIso(startDate.trim(), startTime.trim());
    if (!startIso) {
      setFormError('Enter the start date as YYYY-MM-DD and the start time as HH:MM (24-hour).');
      return;
    }
    let endIso: string | null = null;
    if (endDate.trim() || endTime.trim()) {
      endIso = toIso(endDate.trim() || startDate.trim(), endTime.trim());
      if (!endIso) {
        setFormError('Enter the end date as YYYY-MM-DD and the end time as HH:MM (24-hour).');
        return;
      }
      if (endIso <= startIso) {
        setFormError('The end must be after the start.');
        return;
      }
    }
    setCreating(true);
    try {
      const session = await createSession(
        {
          videoId,
          title: title.trim() ? title.trim() : null,
          scheduledStartAt: startIso,
          scheduledEndAt: endIso,
        },
        ctx.userId,
      );
      const video = publishedVideos.find((v) => v.id === videoId) ?? null;
      setSessions((prev) => [
        {
          ...session,
          video: video
            ? {
                id: video.id,
                title: video.title,
                youtube_video_id: video.youtube_video_id,
                thumbnail_url: video.thumbnail_url,
              }
            : null,
        },
        ...(prev ?? []),
      ]);
      setTitle('');
      setStartTime('');
      setEndDate('');
      setEndTime('');
      setNotice(`Session scheduled for ${formatDateTime(startIso)}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const onCancel = async (session: SessionWithVideo) => {
    setBusyId(session.id);
    setError(null);
    setNotice(null);
    try {
      await cancelSession(session, ctx.userId);
      setSessions((prev) =>
        (prev ?? []).map((s) => (s.id === session.id ? { ...s, status: 'cancelled' } : s)),
      );
      setNotice('Session cancelled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminScroll>
      <View style={styles.form}>
        <SectionTitle>Schedule a session</SectionTitle>
        <Text style={styles.help}>
          A session plays one published recording together, in sync, at the scheduled time. It
          is labelled UPCOMING, then NOW PLAYING, then COMPLETED — a prerecorded samagam is
          never presented as a newly originated live broadcast.
        </Text>

        <Text style={adminStyles.fieldLabel}>Published video</Text>
        {publishedVideos.length === 0 ? (
          <Text style={styles.help}>
            No published videos yet — publish one on the Videos screen first.
          </Text>
        ) : (
          <View style={styles.videoOptions}>
            {publishedVideos.map((v) => (
              <AdminButton
                key={v.id}
                title={videoId === v.id ? `✓ ${v.title}` : v.title}
                variant={videoId === v.id ? 'primary' : 'secondary'}
                onPress={() => setVideoId(v.id)}
              />
            ))}
          </View>
        )}

        <Text style={adminStyles.fieldLabel}>
          Session title (optional — defaults to the video title)
        </Text>
        <TextInput
          style={adminStyles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Haftawari Samagam"
          placeholderTextColor={lightColors.textSecondary}
        />

        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Text style={adminStyles.fieldLabel}>Start date</Text>
            <TextInput
              style={adminStyles.input}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={lightColors.textSecondary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.dateField}>
            <Text style={adminStyles.fieldLabel}>Start time</Text>
            <TextInput
              style={adminStyles.input}
              value={startTime}
              onChangeText={setStartTime}
              placeholder="17:00"
              placeholderTextColor={lightColors.textSecondary}
              autoCapitalize="none"
            />
          </View>
        </View>

        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Text style={adminStyles.fieldLabel}>End date (optional)</Text>
            <TextInput
              style={adminStyles.input}
              value={endDate}
              onChangeText={setEndDate}
              placeholder="Same as start date"
              placeholderTextColor={lightColors.textSecondary}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.dateField}>
            <Text style={adminStyles.fieldLabel}>End time (optional)</Text>
            <TextInput
              style={adminStyles.input}
              value={endTime}
              onChangeText={setEndTime}
              placeholder="19:00"
              placeholderTextColor={lightColors.textSecondary}
              autoCapitalize="none"
            />
          </View>
        </View>

        {formError ? <ErrorBanner message={formError} /> : null}
        <AdminButton
          title={creating ? 'Scheduling…' : 'Schedule session'}
          variant="primary"
          disabled={creating}
          onPress={onCreate}
        />
      </View>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.listHeader}>
        <SectionTitle>Sessions ({sessions?.length ?? 0})</SectionTitle>
        <AdminButton title="Refresh" onPress={load} />
      </View>

      {sessions == null ? (
        <LoadingView label="Loading sessions…" />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No sessions scheduled"
          message="Schedule the first synchronized Samagam session above."
        />
      ) : (
        STATUS_ORDER.map((status) => {
          const rows = grouped.get(status) ?? [];
          if (rows.length === 0) return null;
          return (
            <View key={status} style={styles.group}>
              <View style={styles.groupHeader}>
                <Chip label={SESSION_STATUS_LABEL[status]} tone={sessionStatusTone(status)} />
                <Text style={styles.groupCount}>{rows.length}</Text>
              </View>
              {rows.map((session) => (
                <View key={session.id} style={styles.card}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {session.title ?? session.video?.title ?? 'Untitled session'}
                  </Text>
                  <Text style={styles.meta}>
                    Starts {formatDateTime(session.scheduled_start_at)}
                    {session.scheduled_end_at
                      ? ` · Ends ${formatDateTime(session.scheduled_end_at)}`
                      : ''}
                  </Text>
                  {session.video ? (
                    <Text style={styles.meta}>Recording: {session.video.title}</Text>
                  ) : null}
                  {status === 'upcoming' || status === 'now_playing' ? (
                    <View style={styles.actions}>
                      <ConfirmButton
                        title="Cancel session"
                        confirmTitle="Tap again to cancel"
                        disabled={busyId === session.id}
                        onConfirm={() => void onCancel(session)}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          );
        })
      )}
    </AdminScroll>
  );
}

/** Admin — Sessions: schedule synchronized Samagam sessions from published videos. */
export function AdminSessionsScreen() {
  return <AdminGate>{(ctx) => <SessionsContent ctx={ctx} />}</AdminGate>;
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  help: { ...typography.body, color: lightColors.textSecondary },
  notice: { ...typography.body, color: '#1B5E20' },
  videoOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateRow: { flexDirection: 'row', gap: spacing.md },
  dateField: { flex: 1 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupCount: { ...typography.metadata, color: lightColors.textSecondary },
  card: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: lightColors.surface,
  },
  cardTitle: { ...typography.cardTitle, color: lightColors.text },
  meta: { ...typography.metadata, color: lightColors.textSecondary },
  actions: { flexDirection: 'row', marginTop: spacing.sm },
});
