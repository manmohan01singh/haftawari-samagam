import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Header } from '../layout/Header';
import { EmptyState } from './EmptyState';
import { lightColors } from '../../theme';

interface StubScreenProps {
  title: string;
  message: string;
  showHeader?: boolean;
}

/**
 * Phase 1 screen placeholder: correct chrome (header) + an honest empty
 * state explaining what will appear here once real data exists. Screens
 * are replaced one by one in later phases — never with mock content.
 */
export function StubScreen({ title, message, showHeader = true }: StubScreenProps) {
  return (
    <View style={styles.container}>
      {showHeader ? <Header /> : null}
      <EmptyState title={title} message={message} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
});
