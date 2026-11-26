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
  // Suggestions are stored keyed by the exact query they answer, so a
  // list computed for an earlier keystroke can never render (or flash
  // back after the field is cleared) for the current one.
  const [sugState, setSugState] = useState<{ q: string; rows: Suggestion[] }>({
    q: '',
    rows: [],
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const suggestSeq = useRef(0);
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);

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
          if (suggestSeq.current === seq) setSugState({ q: text, rows });
        })
        .catch(() => {
          if (suggestSeq.current === seq) setSugState({ q: text, rows: [] });
        });
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
      void removeSearchHistory(entry, userId).then(setHistory).catch(() => undefined);
    },
    [userId],
  );

  // Clear-all is destructive, so it is two-step: first tap arms the
  // row ("Tap again to clear all"), second tap within a few seconds
  // clears. The arm resets on its own so it cannot fire much later.
  const onClearHistory = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    void clearSearchHistory(userId)
      .then(() => setHistory([]))
      .catch(() => undefined);
  }, [confirmClear, userId]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const onClearQuery = useCallback(() => {
    setQuery('');
    inputRef.current?.focus();
  }, []);

  const typing = query.trim().length > 0;
  const suggestions = sugState.q === query.trim() ? sugState.rows : [];
  const suggesting = typing && sugState.q !== query.trim();
  const showHistory = !typing && history.length > 0;
  const showSuggestions = typing && suggestions.length > 0;
  const showNoSuggestions = typing && !suggesting && suggestions.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={lightColors.text} />
        </Pressable>
        <View style={styles.field}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search samagams"
            placeholderTextColor={lightColors.textSecondary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => submit()}
            returnKeyType="search"
            autoFocus
            autoCorrect={false}
            enterKeyHint="search"
          />
          {query ? (
            <Pressable onPress={onClearQuery} hitSlop={8} accessibilityLabel="Clear search">
              <MaterialIcons name="close" size={20} color={lightColors.text} />
            </Pressable>
          ) : null}
        </View>
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
                hitSlop={8}
                accessibilityLabel={`Remove "${item}" from search history`}
              >
                <MaterialIcons name="close" size={20} color={lightColors.textSecondary} />
              </Pressable>
            </View>
          )}
          ListHeaderComponent={<Text style={styles.listHeading}>Recent searches</Text>}
          ListFooterComponent={
            <Pressable onPress={onClearHistory} style={styles.clearRow} accessibilityRole="button">
              <Text style={[styles.clearText, confirmClear && styles.clearTextArmed]}>
                {confirmClear ? 'Tap again to clear all search history' : 'Clear all search history'}
              </Text>
            </Pressable>
          }
        />
      ) : showSuggestions ? (
        <FlatList
          data={suggestions}
          keyExtractor={(s, i) => `sug-${s.source}-${s.text}-${i}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
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
              <Pressable
                onPress={() => {
                  setQuery(item.text);
                  inputRef.current?.focus();
                }}
                hitSlop={8}
                accessibilityLabel={`Fill search with "${item.text}" without searching yet`}
              >
                <MaterialIcons name="north-west" size={20} color={lightColors.textSecondary} />
              </Pressable>
            </View>
          )}
        />
      ) : showNoSuggestions ? (
        <View>
          <Text style={styles.hint}>
            No suggestions for &ldquo;{query.trim()}&rdquo; yet.
          </Text>
          <Pressable onPress={() => submit()} style={styles.clearRow} accessibilityRole="button">
            <Text style={styles.clearText}>Search for &ldquo;{query.trim()}&rdquo; anyway</Text>
          </Pressable>
        </View>
      ) : typing ? (
        <Text style={styles.hint}>Searching suggestions…</Text>
      ) : (
        <Text style={styles.hint}>
          Search the published archive and the official channel of Bhai Gursharan Singh Ji. Try a
          shabad title, a word from it, or the channel name.
        </Text>
      )}
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
  clearTextArmed: { color: lightColors.accent },
  listHeading: {
    ...typography.metadata,
    color: lightColors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    textTransform: 'uppercase',
  },
});
