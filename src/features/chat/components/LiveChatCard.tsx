import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import {
  fetchVideoChatMessages,
  isVideoChatUnavailable,
  postVideoChatMessage,
  subscribeVideoChat,
  type VideoChatMessage,
} from '../videoChatService';

interface Props {
  youtubeVideoId: string;
  user: { id: string; displayName: string | null } | null;
  onSignIn: () => void;
}

/**
 * Live chat card for a YouTube LIVE broadcast on the Watch page
 * (fault 42). Session chat covers the app's own Samagam Sessions;
 * this is the sangat's chat for a channel's live broadcast, keyed
 * by the broadcast's YouTube id (migration 0008).
 *
 * Until 0008 is applied the card renders NOTHING (the service
 * detects the missing table) — the comments section below remains
 * the conversation surface, and no fake chat is ever shown.
 */
export function LiveChatCard({ youtubeVideoId, user, onSignIn }: Props) {
  const { colors } = useTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [messages, setMessages] = useState<VideoChatMessage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'hidden' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const countRef = useRef(0);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const rows = await fetchVideoChatMessages(youtubeVideoId);
        if (active) {
          setMessages(rows);
          setState('ready');
        }
      } catch (e) {
        if (active) setState(isVideoChatUnavailable(e) ? 'hidden' : 'error');
      }
    };
    void run();
    const unsubscribe = subscribeVideoChat(youtubeVideoId, () => {
      void run();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [youtubeVideoId, reloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  // Keep the newest message in view as the chat grows.
  useEffect(() => {
    if (messages.length > countRef.current) {
      countRef.current = messages.length;
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages]);

  if (state === 'hidden') return null;

  const send = async () => {
    const body = draft.trim();
    if (!body || !user || sending) return;
    setSending(true);
    try {
      await postVideoChatMessage(youtubeVideoId, user.id, body);
      setDraft('');
      load();
    } catch {
      // The message stays in the box so the user can retry — never
      // pretend a failed send went through.
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <MaterialIcons name="chat" size={18} color={colors.text} />
        <Text style={styles.headerText}>Live chat</Text>
      </View>
      {state === 'loading' ? (
        <View style={styles.centerRow}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.muted}>Loading chat…</Text>
        </View>
      ) : state === 'error' ? (
        <View style={styles.centerRow}>
          <Text style={styles.muted}>Chat could not be loaded.</Text>
          <Pressable onPress={load} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            nestedScrollEnabled
          >
            {messages.length === 0 ? (
              <Text style={styles.muted}>No messages yet — the sangat is listening.</Text>
            ) : (
              messages.map((m) => (
                <View key={m.id} style={styles.msgRow}>
                  <Text style={styles.msgText}>
                    <Text style={styles.msgAuthor}>{m.authorName ?? 'Sangat member'} </Text>
                    {m.body}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          {user ? (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Chat…"
                placeholderTextColor={colors.textSecondary}
                maxLength={500}
                returnKeyType="send"
                onSubmitEditing={() => void send()}
              />
              <Pressable
                onPress={() => void send()}
                disabled={sending || draft.trim().length === 0}
                accessibilityRole="button"
                accessibilityLabel="Send message"
                hitSlop={8}
              >
                <MaterialIcons
                  name="send"
                  size={22}
                  color={draft.trim().length === 0 ? colors.textSecondary : colors.accent}
                />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={onSignIn} accessibilityRole="button" style={styles.signInRow}>
              <Text style={styles.signInText}>Sign in to chat</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surface,
      padding: spacing.md,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    headerText: { ...typography.sectionTitle, color: colors.text },
    centerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    muted: { ...typography.metadata, color: colors.textSecondary },
    retry: { ...typography.metadata, color: colors.accent, fontWeight: '700' },
    list: { maxHeight: 240, marginTop: spacing.sm },
    listContent: { gap: spacing.xs, paddingVertical: spacing.xs },
    msgRow: { paddingVertical: 2 },
    msgText: { ...typography.body, color: colors.text },
    msgAuthor: { fontWeight: '700', color: colors.textSecondary },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
    },
    input: {
      flex: 1,
      ...typography.body,
      color: colors.text,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.background,
    },
    signInRow: { marginTop: spacing.sm, paddingVertical: spacing.xs },
    signInText: { ...typography.metadata, color: colors.accent, fontWeight: '700' },
  });
