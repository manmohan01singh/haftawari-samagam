import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NavigationProp } from '@react-navigation/native';
import { goBackOrTab } from '../../navigation/safeBack';
import { StackHeader } from '../../components/layout/StackHeader';
import { StackTabBar } from '../../components/layout/StackTabBar';
import { spacing, typography, useTheme, type ThemeColors } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

/**
 * Terms + Privacy (blueprint round 2, N6): until now neither page
 * existed, so sign-in/sign-up had nothing to link. The copy states
 * the app's REAL practices only — accounts and app data live in
 * Supabase, playback is the official YouTube player (Google's own
 * cookies and policies apply inside it), guest data stays on the
 * device, and nothing is sold or used for advertising.
 */

function LegalLayout({
  navigation,
  title,
  sections,
}: {
  navigation: NavigationProp<RootStackParamList>;
  title: string;
  sections: { heading: string; body: string }[];
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <StackHeader title={title} onBack={() => goBackOrTab(navigation, 'Library')} />
      <ScrollView contentContainerStyle={styles.content}>
        {sections.map((s) => (
          <View key={s.heading}>
            <Text style={styles.sectionTitle}>{s.heading}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
        <Text style={styles.updated}>Last updated: 28 November 2026</Text>
      </ScrollView>
      <StackTabBar navigation={navigation} />
    </View>
  );
}

type TermsProps = NativeStackScreenProps<RootStackParamList, 'Terms'>;

export function TermsScreen({ navigation }: TermsProps) {
  return (
    <LegalLayout
      navigation={navigation}
      title="Terms of Use"
      sections={[
        {
          heading: 'What this app is',
          body: 'YouTube Gurbani is a sangat app for listening to kirtan and katha recordings from the channels listed in it. Recordings play through the official YouTube player, or — for scheduled Samagam Sessions — through copies hosted for the sangat with the rights holder\u2019s permission.',
        },
        {
          heading: 'Sessions are group playbacks',
          body: 'A Samagam Session is a scheduled group playback of a recording, watched together in sync. It is not a live broadcast, and the app never labels it as one. Counts shown in a session (watching, joined) are the app\u2019s own real counts.',
        },
        {
          heading: 'Your account',
          body: 'You may use the app as a guest. Signing in lets your history, saved recordings, playlists, likes and comments sync across your devices. Keep your password to yourself; you are responsible for activity under your account.',
        },
        {
          heading: 'The recordings',
          body: 'Recordings, titles, artwork and descriptions belong to the channels and rights holders who published them. Nothing in this app gives you a right to copy, download or redistribute them.',
        },
        {
          heading: 'Fair use of the app',
          body: 'Use the app for personal listening and sangat. Do not misuse the chat or comments, attempt to disrupt the service, or use the app in a way that breaks the law or YouTube\u2019s own terms, which also govern the embedded player.',
        },
        {
          heading: 'Availability and changes',
          body: 'The app is provided as-is, free of charge, and may change or be unavailable at times (for example when a video service reaches its limits). These terms may be updated; the date above shows the latest version.',
        },
      ]}
    />
  );
}

type PrivacyProps = NativeStackScreenProps<RootStackParamList, 'Privacy'>;

export function PrivacyScreen({ navigation }: PrivacyProps) {
  return (
    <LegalLayout
      navigation={navigation}
      title="Privacy Policy"
      sections={[
        {
          heading: 'What we store when you sign in',
          body: 'Your email address, your profile (display name and photo if you add one), and the things you do in the app: watch history, saved recordings, playlists, likes and comments. This lives in the app\u2019s Supabase database and is used only to run the app for you.',
        },
        {
          heading: 'What stays on your device',
          body: 'As a guest, your watch history, followed channels and recent searches are stored only on your device. You can clear them any time in Settings \u2192 Data & privacy.',
        },
        {
          heading: 'YouTube playback',
          body: 'Videos play in the official YouTube player embedded in the app. Google may set its own cookies and collect data inside that player, governed by Google\u2019s Privacy Policy \u2014 the same as watching on YouTube itself.',
        },
        {
          heading: 'What we never do',
          body: 'We do not sell your data, we run no advertising of our own, and we do not track you across other apps or websites. The official YouTube player may show YouTube’s own ads before or during a recording — those are served and chosen by YouTube, exactly as on YouTube itself.',
        },
        {
          heading: 'Sessions and chat',
          body: 'When you open a Samagam Session, other viewers can see that someone is watching (a count) and, if you chat, your display name and messages. Guests appear in counts without a name.',
        },
        {
          heading: 'Your choices',
          body: 'You can edit your profile, clear your on-device history and searches in Settings, and sign out at any time. If you want your account and its data deleted, please ask the sangat admin who looks after this app and it will be removed.',
        },
      ]}
    />
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
    sectionTitle: { ...typography.sectionTitle, color: colors.text, marginTop: spacing.md },
    body: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
    updated: { ...typography.metadata, color: colors.textSecondary, marginTop: spacing.xl },
  });
