import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { spacing, typography, useTheme, type ThemeColors } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Help'>;

/**
 * Help — the in-app help page (Settings → Help, YouTube parity,
 * night work 28 Nov 2026: the sweep found no Help row anywhere in
 * Settings). Every section states something the app REALLY does;
 * there is no support contact to list, so none is invented — the
 * page covers how the app itself works.
 */
export function HelpScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <StackHeader title="Help" onBack={() => goBackOrTab(navigation, 'Library')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Samagam Sessions</Text>
        <Text style={styles.body}>
          Sessions are scheduled group playbacks of a recording. When a samagam is
          scheduled, it appears under Sessions labelled UPCOMING, then NOW PLAYING
          while it plays, then COMPLETED. Open a session at its scheduled time and
          it plays in sync with the sangat — the live chat and the joined count on
          that page are the app&apos;s own.
        </Text>

        <Text style={styles.sectionTitle}>Watching recordings</Text>
        <Text style={styles.body}>
          Playback uses the official YouTube player. A copy hosted for a session
          needs you to be signed in; the same recording on YouTube is open to
          everyone, and when a finished session&apos;s recording is also on
          YouTube, its page offers that copy to everyone too.
        </Text>

        <Text style={styles.sectionTitle}>Your account</Text>
        <Text style={styles.body}>
          Sign in with your email and password to sync your history, saved videos and
          playlists across devices. If you forget your password, enter your email on
          the sign-in page and tap &ldquo;Forgot password?&rdquo; — a reset link is
          emailed to you.
        </Text>

        <Text style={styles.sectionTitle}>Saving &amp; playlists</Text>
        <Text style={styles.body}>
          To keep a recording, open its &#8943; menu (on a card, or on the watch
          page) and tap Save — it waits for you under Watch Later in the Library. You
          can also add recordings to playlists of your own from the same menu.
          While signed out, what you watched stays on this device only.
        </Text>

        <Text style={styles.sectionTitle}>Comments</Text>
        <Text style={styles.body}>
          Every recording has a Sangat comments section in this app — the
          sangat&apos;s own comments, separate from YouTube. Many recordings are
          still quiet; sign in to share the first comment.
        </Text>

        <Text style={styles.sectionTitle}>Appearance &amp; playback</Text>
        <Text style={styles.body}>
          Theme in Settings switches between System default, Light and Dark, and
          applies straight away. Autoplay, also in Settings, decides whether a
          recording or Short starts on its own when opened — Samagam Sessions
          always start together at their scheduled time.
        </Text>

        <Text style={styles.sectionTitle}>Search</Text>
        <Text style={styles.body}>
          Search looks through the sangat channels in this app — their recordings
          in the published archive and their latest uploads on YouTube. When
          YouTube&apos;s daily limit for this app is reached, results come from
          the channels&apos; latest uploads and the archive until the limit resets,
          and the results page says so.
        </Text>
      </ScrollView>

      <StackTabBar navigation={navigation} activeTab="Library" />
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    sectionTitle: {
      ...typography.sectionTitle,
      color: colors.text,
      marginTop: spacing.xl,
    },
    body: {
      ...typography.body,
      color: colors.textSecondary,
      marginTop: spacing.sm,
    },
  });
