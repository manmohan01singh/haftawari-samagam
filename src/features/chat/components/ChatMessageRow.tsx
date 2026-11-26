import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { lightColors, spacing } from '../../../theme';
import type { ChatMessageWithAuthor } from '../types';
import { ChatAvatar } from './ChatAvatar';

interface ChatMessageRowProps {
  message: ChatMessageWithAuthor;
}

/** Honest fallback when a member's name is not knowable to the caller. */
export const UNKNOWN_AUTHOR_LABEL = 'Sangat member';

/**
 * One chat row, per screenshot 07: 36px avatar at left; beside it one
 * flowing text block — the author's name in bold, then the message in
 * regular text, wrapping within the text block (continuation lines
 * align with the name, not the avatar). Vertical rhythm ≈11px between
 * rows. Emoji in the body render inline at text size (plain Text).
 */
export const ChatMessageRow = React.memo(function ChatMessageRow({ message }: ChatMessageRowProps) {
  const name = message.author.displayName?.trim() ? message.author.displayName : UNKNOWN_AUTHOR_LABEL;
  return (
    <View style={styles.row}>
      <ChatAvatar userId={message.user_id} displayName={message.author.displayName} />
      <Text style={styles.textBlock}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.gap}>{'  '}</Text>
        <Text style={styles.body}>{message.body}</Text>
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: 5.5, // ≈11px rhythm between rows
  },
  textBlock: {
    flex: 1,
    marginLeft: spacing.md,
    fontSize: 14,
    lineHeight: 20,
  },
  name: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: lightColors.textSecondary,
  },
  gap: {
    fontSize: 14,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: lightColors.text,
  },
});
