import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState, useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { EmptyState } from '../../../components/common/EmptyState';
import { formatCount } from '../../../lib/format';
import { resolveChannelInput, type YouTubeChannelInfo } from '../../../lib/youtube';
import { spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import type { ChannelRecord } from '../../../types/database';
import {
  addChannel,
  deleteChannel,
  listAllChannels,
  moveChannel,
  refreshChannel,
  setChannelActive,
} from '../adminService';
import { invalidateChannelsCache } from '../../channels/channelsService';
import { SUGGESTED_ALIASES, SUGGESTED_CHANNELS } from '../../channels/suggested';
import { AdminGate, type AdminContext } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  Chip,
  ConfirmButton,
  ErrorBanner,
  LoadingView,
  SectionTitle,
  createAdminStyles,
  friendlyError,
} from '../components/AdminUi';

/**
 * Channels panel — the admin decides WHICH YouTube channels appear in
 * the app. Adding is a two-step, honest flow: paste an @handle, channel
 * URL or UC… id → the panel resolves it through the YouTube Data API
 * and shows the REAL title/avatar/subscriber count → only then can the
 * admin save it. Nothing typed by hand is ever stored as channel data.
 * Every mutation is audit-logged (adminService) and invalidates the
 * app-side channel cache so Subscriptions/Search pick it up.
 */
function ChannelsContent({ ctx }: { ctx: AdminContext }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const adminStyles = useMemo(() => createAdminStyles(colors), [colors]);
  const [channels, setChannels] = useState<ChannelRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<YouTubeChannelInfo | null>(null);
  const [resolvedAliases, setResolvedAliases] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setChannels(await listAllChannels());
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err ?? '');
      const code = (err as { code?: string } | null)?.code;
      // The one error this screen can hit before anything else works:
      // the table does not exist until migration 0003 is applied.
      setError(
        code === 'PGRST205' || raw.includes('PGRST205') || raw.toLowerCase().includes('channels')
          ? 'The channels table does not exist yet — migration 0003_channels.sql still needs to be applied in the Supabase SQL Editor. Until then the app keeps showing the original single channel.'
          : friendlyError(err),
      );
      // Do not spin forever under the error banner: fall through to
      // the empty state, whose message explains the same thing.
      setChannels((prev) => prev ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onResolve = async (raw?: string) => {
    const value = (raw ?? input).trim();
    if (!value || resolving) return;
    setResolving(true);
    setError(null);
    setNotice(null);
    setResolved(null);
    try {
      const info = await resolveChannelInput(value);
      if (!info) {
        setError(
          'YouTube did not return a channel for that handle, URL or ID. Check it and try again — nothing was saved.',
        );
        return;
      }
      setResolved(info);
      setResolvedAliases(SUGGESTED_ALIASES[info.channelId] ?? []);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setResolving(false);
    }
  };

  const onAdd = async () => {
    if (!resolved || adding) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const created = await addChannel(resolved, resolvedAliases, ctx.userId);
      invalidateChannelsCache();
      setChannels((prev) =>
        [...(prev ?? []), created].sort((a, b) => a.sort_order - b.sort_order),
      );
      setNotice(`Added "${created.title}" — it is now live in Subscriptions and Search.`);
      setResolved(null);
      setInput('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setAdding(false);
    }
  };

  const runMutation = async (channel: ChannelRecord, action: () => Promise<void>, done: string) => {
    setBusyId(channel.id);
    setError(null);
    setNotice(null);
    try {
      await action();
      invalidateChannelsCache();
      setNotice(done);
      await load();
    } catch (err) {
      setError(friendlyError(err));
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const onMove = async (index: number, direction: -1 | 1) => {
    const list = channels ?? [];
    const channel = list[index];
    const neighbour = list[index + direction];
    if (!channel || !neighbour) return;
    await runMutation(channel, () => moveChannel(channel, neighbour, ctx.userId), 'Order updated.');
  };

  const list = channels ?? [];
  const suggested = SUGGESTED_CHANNELS.filter(
    (s) => !list.some((c) => c.youtube_channel_id === s.youtubeChannelId),
  );

  return (
    <AdminScroll>
      <View style={styles.form}>
        <SectionTitle>Add a channel</SectionTitle>
        <Text style={styles.help}>
          Paste an @handle, a youtube.com channel URL, or a UC… channel ID. The channel is looked
          up on YouTube first — you confirm the real channel before anything is saved.
        </Text>
        <TextInput
          style={adminStyles.input}
          value={input}
          onChangeText={(v) => {
            setInput(v);
            setResolved(null);
          }}
          placeholder="e.g. @amritvelatrustlive or youtube.com/@amritvelatrustlive"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <AdminButton
          title={resolving ? 'Looking up on YouTube…' : 'Look up channel'}
          variant="primary"
          disabled={resolving || !input.trim()}
          onPress={() => void onResolve()}
        />
        {resolved ? (
          <View style={styles.preview}>
            <View style={styles.row}>
              {resolved.avatarUrl ? (
                <Image source={{ uri: resolved.avatarUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{resolved.title.charAt(0)}</Text>
                </View>
              )}
              <View style={styles.rowText}>
                <Text style={styles.channelTitle}>{resolved.title}</Text>
                <Text style={styles.channelMeta}>
                  {[resolved.handle, resolved.subscriberCount != null ? `${formatCount(resolved.subscriberCount)} subscribers` : null, resolved.videoCount != null ? `${formatCount(resolved.videoCount)} videos` : null]
                    .filter(Boolean)
                    .join('\u00A0•\u00A0')}
                </Text>
                <Text style={styles.channelMeta}>{resolved.channelId}</Text>
              </View>
            </View>
            <AdminButton
              title={adding ? 'Adding…' : 'Add this channel'}
              variant="primary"
              disabled={adding}
              onPress={() => void onAdd()}
            />
          </View>
        ) : null}
      </View>

      {suggested.length > 0 ? (
        <View style={styles.form}>
          <SectionTitle>Suggested — tap to look up</SectionTitle>
          <Text style={styles.help}>
            Resolved via the YouTube Data API on 26 Nov 2026. Tapping fills in the handle and runs
            a fresh lookup, so the counts you confirm are current. Nothing is added until you tap
            “Add this channel”.
          </Text>
          {suggested.map((s) => (
            <View key={s.youtubeChannelId} style={styles.row}>
              <Image source={{ uri: s.avatarUrl }} style={styles.avatar} contentFit="cover" />
              <View style={styles.rowText}>
                <Text style={styles.channelTitle}>{s.title}</Text>
                <Text style={styles.channelMeta}>
                  {s.handle}  •  {formatCount(s.subscriberCount)} subscribers  •  {formatCount(s.videoCount)} videos
                </Text>
                <Text style={styles.help}>{s.note}</Text>
              </View>
              <AdminButton
                title="Look up"
                disabled={resolving}
                onPress={() => {
                  setInput(s.handle);
                  void onResolve(s.handle);
                }}
              />
            </View>
          ))}
        </View>
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View>
        <View style={styles.listHeader}>
          <SectionTitle>Channels in the app ({list.length})</SectionTitle>
          <AdminButton title="Refresh" onPress={load} />
        </View>
        {channels === null ? (
          <LoadingView label="Loading channels…" />
        ) : list.length === 0 ? (
          <EmptyState
            title="No channels yet"
            message="Add the first channel above. Until the channels table exists (migration 0003), the app keeps showing the original single channel."
          />
        ) : (
          list.map((channel, index) => (
            <View key={channel.id} style={styles.channelRow}>
              <View style={styles.row}>
                {channel.avatar_url ? (
                  <Image source={{ uri: channel.avatar_url }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{channel.title.charAt(0)}</Text>
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.channelTitle}>{channel.title}</Text>
                  <Text style={styles.channelMeta}>
                    {[channel.handle, channel.youtube_channel_id].filter(Boolean).join('\u00A0•\u00A0')}
                  </Text>
                </View>
                <Chip label={channel.is_active ? 'Active' : 'Inactive'} tone={channel.is_active ? 'dark' : 'outline'} />
              </View>
              <View style={styles.actions}>
                <AdminButton
                  title={channel.is_active ? 'Deactivate' : 'Activate'}
                  disabled={busyId === channel.id}
                  onPress={() =>
                    void runMutation(
                      channel,
                      async () => {
                        await setChannelActive(channel, !channel.is_active, ctx.userId);
                      },
                      channel.is_active
                        ? `"${channel.title}" hidden from the app.`
                        : `"${channel.title}" is now shown in the app.`,
                    )
                  }
                />
                <AdminButton
                  title="↑"
                  disabled={busyId === channel.id || index === 0}
                  onPress={() => void onMove(index, -1)}
                />
                <AdminButton
                  title="↓"
                  disabled={busyId === channel.id || index === list.length - 1}
                  onPress={() => void onMove(index, 1)}
                />
                <AdminButton
                  title="Refresh info"
                  disabled={busyId === channel.id}
                  onPress={() =>
                    void runMutation(
                      channel,
                      async () => {
                        await refreshChannel(channel, ctx.userId);
                      },
                      `Refreshed "${channel.title}" from YouTube.`,
                    )
                  }
                />
                <ConfirmButton
                  title="Remove"
                  confirmTitle="Remove — confirm?"
                  disabled={busyId === channel.id}
                  onConfirm={() =>
                    void runMutation(
                      channel,
                      async () => {
                        await deleteChannel(channel, ctx.userId);
                      },
                      `Removed "${channel.title}" from the panel.`,
                    )
                  }
                />
              </View>
            </View>
          ))
        )}
      </View>
    </AdminScroll>
  );
}

/** Admin channels panel — admin-gated; RLS enforces the writes. */
export function AdminChannelsScreen() {
  return <AdminGate>{(ctx) => <ChannelsContent ctx={ctx} />}</AdminGate>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  form: { gap: spacing.sm },
  help: { ...typography.metadata, color: colors.textSecondary },
  notice: { ...typography.body, color: colors.text },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  preview: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
  },
  channelRow: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: {
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 18, fontWeight: '600', color: colors.textSecondary },
  channelTitle: { ...typography.cardTitle, color: colors.text },
  channelMeta: { ...typography.metadata, color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
