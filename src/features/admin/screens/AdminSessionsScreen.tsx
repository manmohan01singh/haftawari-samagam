import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { useServerClock } from '../../sessions/hooks/useServerClock';
import { deriveStatus } from '../../sessions/stateMachine';
import { spacing, typography, useTheme, type ThemeColors } from '../../../theme';
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
  createAdminStyles,
  formatDateTime,
  sessionStatusTone,
  friendlyError,
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
  const [y, mo, da] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  if (h > 23 || mi > 59) return null;
  const d = new Date(`${dateStr}T${timeStr}:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check: JS silently rolls 30 Feb → 2 Mar; reject that.
  if (d.getFullYear() !== y || d.getMonth() + 1 !== mo || d.getDate() !== da) return null;
  return d.toISOString();
}

/** Split an ISO instant back into local YYYY-MM-DD / HH:MM fields. */
function splitLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function SessionsContent({ ctx }: { ctx: AdminContext }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const adminStyles = useMemo(() => createAdminStyles(colors), [colors]);
  // Server-clock tick (30s): the list below groups sessions by their
  // EFFECTIVE (derived) status, so a session whose start time arrives
  // moves UPCOMING → NOW PLAYING here on its own — the stored status
  // column is only ever written at create ('upcoming') / cancel time
  // and would otherwise leave this screen permanently stale.
  const { nowMs } = useServerClock(30_000);
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
  // "Now" for the future-start check, refreshed on focus and each
  // minute — kept in state so validation stays a pure function of it.
  const [nowTs, setNowTs] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setNowTs(Date.now());
      const t = setInterval(() => setNowTs(Date.now()), 60000);
      return () => clearInterval(t);
    }, []),
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sess, pubs] = await Promise.all([listSessionsWithVideo(), listPublishedVideos()]);
      setSessions(sess);
      setPublishedVideos(pubs);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Live validation + preview, computed from the fields as typed —
  // problems are shown BEFORE submit, not discovered after it.
  const schedule = useMemo(() => {
    const problems: string[] = [];
    const startIso = startTime.trim() ? toIso(startDate.trim(), startTime.trim()) : null;
    if (!startTime.trim()) {
      problems.push('Enter a start time.');
    } else if (!startIso) {
      problems.push('Start date/time is not a real date — use YYYY-MM-DD and HH:MM (24-hour).');
    } else if (nowTs > 0 && new Date(startIso).getTime() <= nowTs) {
      problems.push('Start must be in the future.');
    }
    let endIso: string | null = null;
    if (endDate.trim() || endTime.trim()) {
      endIso = toIso(endDate.trim() || startDate.trim(), endTime.trim());
      if (!endIso) {
        problems.push('End date/time is not a real date — use YYYY-MM-DD and HH:MM (24-hour).');
      } else if (startIso && endIso <= startIso) {
        problems.push('End must be after the start.');
      }
    }
    return { problems, startIso, endIso };
  }, [startDate, startTime, endDate, endTime, nowTs]);

  const fillEndPlus2h = useCallback(() => {
    if (!schedule.startIso) return;
    const end = new Date(new Date(schedule.startIso).getTime() + 2 * 60 * 60 * 1000);
    const parts = splitLocal(end.toISOString());
    setEndDate(parts.date);
    setEndTime(parts.time);
  }, [schedule.startIso]);

  const grouped = useMemo(() => {
    const map = new Map<SessionStatus, SessionWithVideo[]>();
    for (const status of STATUS_ORDER) map.set(status, []);
    for (const s of sessions ?? []) {
      // Group by the EFFECTIVE status derived from the server clock
      // (same state machine as the user-facing screens), not the raw
      // stored column — stored is written only at create/cancel.
      const effective = deriveStatus({
        storedStatus: s.status,
        scheduledStartAt: s.scheduled_start_at,
        scheduledEndAt: s.scheduled_end_at,
        durationSeconds: s.video?.duration_seconds ?? null,
        nowMs,
      });
      map.get(effective)?.push(s);
    }
    return map;
  }, [sessions, nowMs]);

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
    if (new Date(startIso).getTime() <= Date.now()) {
      setFormError('Start must be in the future.');
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
        setFormError('End must be after the start.');
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
                duration_seconds: video.duration_seconds,
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
      setFormError(friendlyError(err));
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
      setError(friendlyError(err));
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
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={styles.help}>
          Dates are YYYY-MM-DD and times are 24-hour HH:MM, in your device&rsquo;s local time.
        </Text>
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <Text style={adminStyles.fieldLabel}>Start date</Text>
            <TextInput
              style={adminStyles.input}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.dateField}>
            <Text style={adminStyles.fieldLabel}>Start time</Text>
            <TextInput
              style={adminStyles.input}
              value={startTime}
              onChangeText={setStartTime}
              placeholder="17:00"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
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
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.dateField}>
            <Text style={adminStyles.fieldLabel}>End time (optional)</Text>
            <TextInput
              style={adminStyles.input}
              value={endTime}
              onChangeText={setEndTime}
              placeholder="19:00"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        {schedule.startIso ? (
          <AdminButton
            title="Set end to 2 hours after start"
            disabled={creating}
            onPress={fillEndPlus2h}
          />
        ) : null}

        {schedule.startIso ? (
          <View style={styles.previewBox}>
            <Text style={styles.previewText}>
              Starts: {formatDateTime(schedule.startIso)}
              {schedule.endIso ? `\nEnds: ${formatDateTime(schedule.endIso)}` : ''}
            </Text>
          </View>
        ) : null}

        {schedule.problems.length > 0 ? (
          <View style={styles.problemsBox}>
            {schedule.problems.map((p) => (
              <Text key={p} style={styles.problemText}>
                {p}
              </Text>
            ))}
          </View>
        ) : null}

        {formError ? <ErrorBanner message={formError} /> : null}
        <AdminButton
          title={creating ? 'Scheduling…' : 'Schedule session'}
          variant="primary"
          disabled={creating || !videoId || schedule.problems.length > 0}
          onPress={onCreate}
        />
        {!videoId ? (
          <Text style={styles.help}>Choose a published video above to enable scheduling.</Text>
        ) : null}
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  form: { gap: spacing.md },
  help: { ...typography.body, color: colors.textSecondary },
  notice: { ...typography.body, color: '#1B5E20' },
  videoOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateRow: { flexDirection: 'row', gap: spacing.md },
  dateField: { flex: 1 },
  previewBox: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 12,
    padding: spacing.md,
  },
  previewText: { ...typography.body, color: colors.text },
  problemsBox: {
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  problemText: { ...typography.body, color: '#8B0000' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  group: { gap: spacing.sm },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  groupCount: { ...typography.metadata, color: colors.textSecondary },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  cardTitle: { ...typography.cardTitle, color: colors.text },
  meta: { ...typography.metadata, color: colors.textSecondary },
  actions: { flexDirection: 'row', marginTop: spacing.sm },
});
