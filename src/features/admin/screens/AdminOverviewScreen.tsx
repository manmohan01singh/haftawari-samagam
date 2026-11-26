import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lightColors, spacing, typography } from '../../../theme';
import type { AdminStackParamList } from '../../../navigation/types';
import { fetchOverviewCounts, type OverviewCounts } from '../adminService';
import { AdminGate } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  ErrorBanner,
  LoadingView,
  SectionTitle,
  StatCard,
  friendlyError,
} from '../components/AdminUi';

type Props = NativeStackScreenProps<AdminStackParamList, 'AdminOverview'>;

const LINKS: { route: keyof AdminStackParamList; label: string; hint: string }[] = [
  { route: 'AdminVideos', label: 'Videos', hint: 'Add samagams from YouTube, publish or unpublish' },
  { route: 'AdminChannels', label: 'Channels', hint: 'Choose which YouTube channels appear in the app' },
  { route: 'AdminSessions', label: 'Sessions', hint: 'Schedule synchronized Samagam sessions' },
  { route: 'AdminCategories', label: 'Categories', hint: 'Organise the archive shelves' },
  { route: 'AdminMembers', label: 'Members', hint: 'See who has joined and their roles' },
  { route: 'AdminChatModeration', label: 'Chat moderation', hint: 'Review and remove chat messages' },
  { route: 'AdminAuditLogs', label: 'Audit logs', hint: 'Every admin action, recorded' },
];

function OverviewContent({ navigation }: { navigation: Props['navigation'] }) {
  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCounts(await fetchOverviewCounts());
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (error) {
    return (
      <AdminScroll>
        <ErrorBanner message={`Could not load the overview: ${error}`} onRetry={load} />
      </AdminScroll>
    );
  }
  if (!counts) return <LoadingView label="Loading real totals…" />;

  return (
    <AdminScroll>
      <View>
        <SectionTitle>Library</SectionTitle>
        <View style={styles.statGrid}>
          <StatCard label="Videos — published" value={counts.videosPublished} />
          <StatCard label="Videos — drafts" value={counts.videosDraft} />
          <StatCard label="Videos — unpublished" value={counts.videosUnpublished} />
          <StatCard label="Categories" value={counts.categories} />
          <StatCard label="Channels — active" value={counts.channelsActive} />
          <StatCard label="Channels — total" value={counts.channelsTotal} />
        </View>
      </View>

      <View>
        <SectionTitle>Sessions</SectionTitle>
        <View style={styles.statGrid}>
          <StatCard label="UPCOMING" value={counts.sessionsByStatus.upcoming} />
          <StatCard label="NOW PLAYING" value={counts.sessionsByStatus.now_playing} />
          <StatCard label="COMPLETED" value={counts.sessionsByStatus.completed} />
          <StatCard label="CANCELLED" value={counts.sessionsByStatus.cancelled} />
        </View>
      </View>

      <View>
        <SectionTitle>Community</SectionTitle>
        <View style={styles.statGrid}>
          <StatCard label="Members" value={counts.members} />
          <StatCard label="Chat messages" value={counts.chatMessages} />
          <StatCard label="Chat — removed" value={counts.chatRemoved} />
        </View>
      </View>

      <View style={styles.links}>
        <SectionTitle>Manage</SectionTitle>
        {LINKS.map((link) => (
          <View key={link.route} style={styles.linkRow}>
            <View style={styles.linkText}>
              <Text style={styles.linkLabel}>{link.label}</Text>
              <Text style={styles.linkHint}>{link.hint}</Text>
            </View>
            <AdminButton title="Open" onPress={() => navigation.navigate(link.route)} />
          </View>
        ))}
        <AdminButton title="Refresh totals" onPress={load} />
      </View>
    </AdminScroll>
  );
}

/** Admin overview — real counts from Supabase; nothing is estimated. */
export function AdminOverviewScreen({ navigation }: Props) {
  return (
    <AdminGate>
      {() => <OverviewContent navigation={navigation} />}
    </AdminGate>
  );
}

const styles = StyleSheet.create({
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  links: { gap: spacing.md },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  linkText: { flex: 1 },
  linkLabel: { ...typography.cardTitle, color: lightColors.text },
  linkHint: { ...typography.metadata, color: lightColors.textSecondary },
});
