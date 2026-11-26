import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { lightColors, radii, spacing, typography } from '../../theme';
import { useAuth } from '../../features/auth';
import {
  addSearchHistory,
  clearSearchHistory,
  getSuggestions,
  listSearchHistory,
  removeSearchHistory,
  type Suggestion,
} from '../../features/search';
import type { RootStackParamList } from '../../navigation/types';
import { SMALL_ICON_HIT_SLOP } from '../../lib/touch';
import { ConfirmModal } from '../../features/library/components/ConfirmModal';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

/**
 * Search entry (reference §3 search bar): back arrow, a light pill
 * field holding the query with a × clear inside its right end.
 *
 * Below the bar, the search engine (features/search, docs/SEARCH.md)
 * drives the list: while the field is empty it shows the user's REAL
 * recent searches (on-device, per user — removable, clearable); while
 * typing it shows quota-free suggestions from history, the published
 * catalogue and the official channel. Submitting records the query in
 * history and runs the full search on the results screen.
 */
export function SearchScreen({ navigation }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // QA45: destructive history actions get safeguards — Clear-all asks
  // first (ConfirmModal), and a single remove can be undone.
  const [confirmClear, setConfirmClear] = useState(false);
  const [lastRemoved, setLastRemoved] = useState<string | null>(null);

  useEffect(() => {
    if (!lastRemoved) return;
    const t = setTimeout(() => setLastRemoved(null), 5000);
    return () => clearTimeout(t);
  }, [lastRemoved]);
  const suggestSeq = useRef(0);

  // Load this user's recent searches (guest bucket when signed out).
  useEffect(() => {
    let active = true;
    listSearchHistory(userId)
      .then((entries) => {
        if (active) setHistory(entries);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId]);

  // Debounced suggestions while typing; stale responses are dropped
  // by sequence number so a slow earlier reply can never overwrite a
  // newer list.
  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    const seq = ++suggestSeq.current;
    const t = setTimeout(() => {
      getSuggestions(text, { userId })
        .then((rows) => {
          if (suggestSeq.current === seq) setSuggestions(rows);
        })
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [query, userId]);

  const submit = useCallback(
    (raw?: string) => {
      const q = (raw ?? query).trim();
      if (!q) return;
      void addSearchHistory(q, userId).then(setHistory).catch(() => undefined);
      navigation.navigate('SearchResults', { query: q });
    },
    [navigation, query, userId],
  );

  const onRemoveHistory = useCallback(
    (entry: string) => {
      setLastRemoved(entry);
      void removeSearchHistory(entry, userId).then(setHistory).catch(() => undefined);
    },
    [userId],
  );

  const onUndoRemove = useCallback(() => {
    if (!lastRemoved) return;
    const entry = lastRemoved;
    setLastRemoved(null);
    void addSearchHistory(entry, userId).then(setHistory).catch(() => undefined);
  }, [lastRemoved, userId]);

  const onClearHistory = useCallback(() => {
    setConfirmClear(false);
    void clearSearchHistory(userId)
      .then(() => setHistory([]))
      .catch(() => undefined);
  }, [userId]);

  const typing = query.trim().length > 0;
  const showHistory = !typing && history.length > 0;
  const showSuggestions = typing && suggestions.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            placeholder="Search samagams"
            placeholderTextColor={lightColors.textSecondary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => submit()}
            returnKeyType="search"
            autoFocus
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={SMALL_ICON_HIT_SLOP} accessibilityLabel="Clear search" accessibilityRole="button">
              <MaterialIcons name="close" size={20} color={lightColors.text} />
            </Pressable>
          ) : null}
        </View>
        {/* QA41: a visible submit affordance — search must not be Enter-only. */}
        <Pressable
          style={styles.submitButton}
          onPress={() => submit()}
          accessibilityLabel="Search"
          accessibilityRole="button"
        >
          <MaterialIcons name="search" size={22} color={lightColors.subscribeText} />
        </Pressable>
      </View>

      {showHistory ? (
        <FlatList
          data={history}
          keyExtractor={(entry) => `hist-${entry}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => submit(item)}
                accessibilityRole="button"
              >
                <MaterialIcons name="history" size={22} color={lightColors.textSecondary} />
                <Text style={styles.rowText} numberOfLines={1}>
                  {item}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onRemoveHistory(item)}
                hitSlop={SMALL_ICON_HIT_SLOP}
                accessibilityLabel={`Remove "${item}" from search history`}
              >
                <MaterialIcons name="close" size={20} color={lightColors.textSecondary} />
              </Pressable>
            </View>
          )}
          ListFooterComponent={
            <Pressable onPress={() => setConfirmClear(true)} style={styles.clearRow} accessibilityRole="button">
              <Text style={styles.clearText}>Clear all search history</Text>
            </Pressable>
          }
        />
      ) : showSuggestions ? (
        <FlatList
          data={suggestions}
          keyExtractor={(s, i) => `sug-${s.source}-${s.text}-${i}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => submit(item.text)}
              accessibilityRole="button"
            >
              <MaterialIcons
                name={item.source === 'history' ? 'history' : 'search'}
                size={22}
                color={lightColors.textSecondary}
              />
              <Text style={styles.rowText} numberOfLines={1}>
                {item.text}
              </Text>
            </Pressable>
          )}
        />
      ) : (
        <Text style={styles.hint}>
          Search the published archive and the official channel of Bhai Gursharan Singh Ji.
        </Text>
      )}

      {lastRemoved ? (
        <View style={styles.undoBar}>
          <Text style={styles.undoText} numberOfLines={1}>
            Removed “{lastRemoved}”
          </Text>
          <Pressable onPress={onUndoRemove} hitSlop={8} accessibilityRole="button">
            <Text style={styles.undoAction}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      <ConfirmModal
        visible={confirmClear}
        title="Clear all search history?"
        message="This removes every recent search saved on this device. This cannot be undone."
        confirmLabel="Clear all"
        onConfirm={onClearHistory}
        onCancel={() => setConfirmClear(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: lightColors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: 44,
  },
  input: { flex: 1, fontSize: 16, color: lightColors.text },
  hint: {
    ...typography.body,
    color: lightColors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { ...typography.body, fontSize: 16, color: lightColors.text, flex: 1 },
  clearRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  clearText: { ...typography.body, fontWeight: '600', color: lightColors.text },
  submitButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: lightColors.subscribeBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: lightColors.text,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  undoText: { flex: 1, color: lightColors.subscribeText, fontSize: 14 },
  undoAction: { color: '#8AB4F8', fontSize: 14, fontWeight: '700' },
});
