import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { lightColors, radii, spacing, typography } from '../../theme';
import { useAuth } from '../../features/auth';
import {
  addSearchHistory,
  clearSearchHistory,
  fetchPublishedVideos,
  getSuggestions,
  listSearchHistoryEntries,
  removeSearchHistory,
  type SearchHistoryEntry,
  type Suggestion,
} from '../../features/search';
import { ConfirmModal } from '../../features/library/components/ConfirmModal';
import type { Video } from '../../types/database';
import { goBackOrTab } from '../../navigation/safeBack';
import type { RootStackParamList } from '../../navigation/types';
import { ROW_LIST_PERF } from '../../lib/listPerf';

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
  const [historyEntries, setHistoryEntries] = useState<SearchHistoryEntry[]>([]);
  const history = historyEntries.map((e) => e.text);
  const [catalogue, setCatalogue] = useState<Video[]>([]);
  // Suggestions are stored keyed by the exact query they answer, so a
  // list computed for an earlier keystroke can never render (or flash
  // back after the field is cleared) for the current one.
  const [sugState, setSugState] = useState<{ q: string; rows: Suggestion[] }>({
    q: '',
    rows: [],
  });
  const [confirmClear, setConfirmClear] = useState(false); // ConfirmModal visibility
  const suggestSeq = useRef(0);
  const inputRef = useRef<React.ElementRef<typeof TextInput>>(null);

  // Load this user's recent searches (guest bucket when signed out).
  useEffect(() => {
    let active = true;
    listSearchHistoryEntries(userId)
      .then((entries) => {
        if (active) setHistoryEntries(entries);
      })
      .catch(() => undefined);
    // Real shortcuts for the empty state (QA 96): the published
    // catalogue itself — tapping a title runs that search. No
    // fabricated "trending" list.
    fetchPublishedVideos()
      .then((videos) => {
        if (active) setCatalogue(videos);
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
    }, 300); // 300 ms debounce, as designed (docs/SEARCH.md)
    return () => clearTimeout(t);
  }, [query, userId]);

  const submit = useCallback(
    (raw?: string) => {
      const q = (raw ?? query).trim();
      if (!q) return;
      void addSearchHistory(q, userId).then(() => listSearchHistoryEntries(userId)).then(setHistoryEntries).catch(() => undefined);
      navigation.navigate('SearchResults', { query: q });
    },
    [navigation, query, userId],
  );

  const onRemoveHistory = useCallback(
    (entry: string) => {
      void removeSearchHistory(entry, userId).then(() => listSearchHistoryEntries(userId)).then(setHistoryEntries).catch(() => undefined);
    },
    [userId],
  );

  // Clear-all is destructive: it goes through the shared ConfirmModal
  // (same component as Library's clear-all, QA 97 / issue 45) so the
  // confirmation pattern is identical everywhere in the app.
  const onClearHistory = useCallback(() => {
    setConfirmClear(false);
    void clearSearchHistory(userId)
      .then(() => setHistoryEntries([]))
      .catch(() => undefined);
  }, [userId]);

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
        <Pressable onPress={() => goBackOrTab(navigation, 'Home')} hitSlop={10} accessibilityLabel="Back">
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

      {showHistory || (!typing && catalogue.length > 0) ? (
        <FlatList
          {...ROW_LIST_PERF}
          data={historyEntries}
          keyExtractor={(entry) => `hist-${entry.text}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => submit(item.text)}
                accessibilityRole="button"
              >
                <MaterialIcons name="history" size={22} color={lightColors.textSecondary} />
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowText} numberOfLines={1}>
                    {item.text}
                  </Text>
                  {item.searchedAt ? (
                    <Text style={styles.rowSub}>{formatWhen(item.searchedAt)}</Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                onPress={() => onRemoveHistory(item.text)}
                hitSlop={12}
                style={styles.removeBtn}
                accessibilityLabel={`Remove "${item.text}" from search history`}
              >
                <MaterialIcons name="close" size={20} color={lightColors.textSecondary} />
              </Pressable>
            </View>
          )}
          ListHeaderComponent={
            <View>
              {historyEntries.length > 0 ? (
                <View style={styles.headingRow}>
                  <Text style={styles.listHeading}>Recent searches</Text>
                  <Pressable onPress={() => setConfirmClear(true)} accessibilityRole="button" hitSlop={8}>
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </Pressable>
                </View>
              ) : null}
              {catalogue.length > 0 ? (
                <>
                  <Text style={styles.listHeading}>From the archive</Text>
                  {catalogue.slice(0, 8).map((video) => (
                    <Pressable
                      key={video.id}
                      style={styles.row}
                      onPress={() => submit(video.title)}
                      accessibilityRole="button"
                    >
                      <MaterialIcons name="play-circle-outline" size={22} color={lightColors.textSecondary} />
                      <Text style={styles.rowText} numberOfLines={1}>
                        {video.title}
                      </Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </View>
          }
        />
      ) : showSuggestions ? (
        <FlatList
          {...ROW_LIST_PERF}
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
      <ConfirmModal
        visible={confirmClear}
        title="Clear search history?"
        message="This removes all your recent searches on this device. It cannot be undone."
        confirmLabel="Clear all"
        onConfirm={onClearHistory}
        onCancel={() => setConfirmClear(false)}
      />
    </View>
  );
}

/** Relative label for a history timestamp (real stored value only). */
function formatWhen(ts: number): string {
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ts).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: lightColors.background, width: '100%', maxWidth: 960, alignSelf: 'center' },
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
  input: { flex: 1, fontSize: 16, color: lightColors.text, outlineStyle: 'none' } as object,
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
  },
  clearAllText: { ...typography.chip, color: lightColors.text, paddingVertical: spacing.sm },
  removeBtn: { padding: spacing.sm },
  rowTextWrap: { flex: 1 },
  rowSub: { ...typography.metadata, color: lightColors.textSecondary },
  listHeading: {
    ...typography.metadata,
    color: lightColors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    textTransform: 'uppercase',
  },
});
