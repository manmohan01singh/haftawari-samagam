import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { spacing, typography, useTheme, type ThemeColors } from '../../../theme';
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
  { route: 'AdminHosted', label: 'Hosted videos', hint: 'Original files from the rights holder, authorization-gated publishing' },
  { route: 'AdminChannels', label: 'Channels', hint: 'Choose which YouTube channels appear in the app' },
  { route: 'AdminSessions', label: 'Sessions', hint: 'Schedule synchronized Samagam sessions' },
  { route: 'AdminCategories', label: 'Categories', hint: 'Organise the archive shelves' },
  { route: 'AdminMembers', label: 'Members', hint: 'See who has joined and their roles' },
  { route: 'AdminChatModeration', label: 'Chat moderation', hint: 'Review and remove chat messages' },
  { route: 'AdminAuditLogs', label: 'Audit logs', hint: 'Every admin action, recorded' },
];

function OverviewContent({ navigation }: { navigation: Props['navigation'] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
          // The whole row is the tap target (audit C4) — the label
          // and hint used to be dead area beside a small button.
          <Pressable
            key={link.route}
            style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
            onPress={() => navigation.navigate(link.route)}
            accessibilityRole="button"
            accessibilityLabel={`${link.label}: ${link.hint}`}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkLabel}>{link.label}</Text>
              <Text style={styles.linkHint}>{link.hint}</Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
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
    minHeight: 52,
    paddingVertical: spacing.sm,
  },
  linkRowPressed: { backgroundColor: colors.surfaceVariant, opacity: 0.85 },
  linkText: { flex: 1 },
  linkLabel: { ...typography.cardTitle, color: colors.text },
  linkHint: { ...typography.metadata, color: colors.textSecondary },
});
