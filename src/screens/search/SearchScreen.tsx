import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OrbBackground } from '../../components/layout/OrbBackground';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../theme';
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
import { SMALL_ICON_HIT_SLOP } from '../../lib/touch';

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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
  // QA45: a single history remove can be undone — the removed entry is
  // held for 5s while the undo bar is visible.
  const [lastRemoved, setLastRemoved] = useState<string | null>(null);

  useEffect(() => {
    if (!lastRemoved) return;
    const t = setTimeout(() => setLastRemoved(null), 5000);
    return () => clearTimeout(t);
  }, [lastRemoved]);
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
      setLastRemoved(entry);
      void removeSearchHistory(entry, userId).then(() => listSearchHistoryEntries(userId)).then(setHistoryEntries).catch(() => undefined);
    },
    [userId],
  );

  // Clear-all is destructive: it goes through the shared ConfirmModal
  // (same component as Library's clear-all, QA 97 / issue 45) so the
  // confirmation pattern is identical everywhere in the app.
  const onUndoRemove = useCallback(() => {
    if (!lastRemoved) return;
    const entry = lastRemoved;
    setLastRemoved(null);
    void addSearchHistory(entry, userId).then(() => listSearchHistoryEntries(userId)).then(setHistoryEntries).catch(() => undefined);
  }, [lastRemoved, userId]);

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
      <OrbBackground />
      <View style={[styles.bar, { paddingTop: spacing.lg + insets.top }]}>
        <Pressable onPress={() => goBackOrTab(navigation, 'Home')} hitSlop={10} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.field}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search samagams"
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => submit()}
            returnKeyType="search"
            autoFocus
            autoCorrect={false}
            enterKeyHint="search"
          />
          {query ? (
            <Pressable onPress={onClearQuery} hitSlop={SMALL_ICON_HIT_SLOP} accessibilityLabel="Clear search" accessibilityRole="button">
              <MaterialIcons name="close" size={20} color={colors.text} />
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
          <MaterialIcons name="search" size={22} color={colors.subscribeText} />
        </Pressable>
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
                style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
                onPress={() => submit(item.text)}
                accessibilityRole="button"
              >
                <MaterialIcons name="history" size={22} color={colors.textSecondary} />
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
                hitSlop={SMALL_ICON_HIT_SLOP}
                style={styles.removeBtn}
                accessibilityLabel={`Remove "${item.text}" from search history`}
              >
                <MaterialIcons name="close" size={20} color={colors.textSecondary} />
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
            </View>
          }
          ListFooterComponent={
            // Round-3 sweep (27 Nov 2026): the archive list used to
            // live INSIDE the ListHeaderComponent, so the DOM/visual
            // order was heading → archive rows → the history rows the
            // heading belonged to. Archive is a footer now: recents
            // sit directly under their heading, archive below them.
            catalogue.length > 0 ? (
              <View>
                <Text style={styles.listHeading}>From the archive</Text>
                {catalogue.slice(0, 8).map((video) => (
                  <Pressable
                    key={video.id}
                    style={styles.row}
                    onPress={() => submit(video.title)}
                    accessibilityRole="button"
                  >
                    <MaterialIcons name="play-circle-outline" size={22} color={colors.textSecondary} />
                    <Text style={styles.rowText} numberOfLines={1}>
                      {video.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : undefined
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
                style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
                onPress={() => submit(item.text)}
                accessibilityRole="button"
              >
                <MaterialIcons
                  name={item.source === 'history' ? 'history' : 'search'}
                  size={22}
                  color={colors.textSecondary}
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
                <MaterialIcons name="north-west" size={20} color={colors.textSecondary} />
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, width: '100%', maxWidth: 960, alignSelf: 'center' },
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
    backgroundColor: colors.surfaceVariant,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    height: 44,
  },
  input: { flex: 1, fontSize: 16, color: colors.text, outlineStyle: 'none' } as object,
  hint: {
    ...typography.body,
    color: colors.textSecondary,
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
  rowPressed: { backgroundColor: colors.surfaceVariant, borderRadius: 8 },
  rowText: { ...typography.body, fontSize: 16, color: colors.text, flex: 1 },
  clearRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  clearText: { ...typography.body, fontWeight: '600', color: colors.text },
  clearTextArmed: { color: colors.accent },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.lg,
  },
  clearAllText: { ...typography.chip, color: colors.text, paddingVertical: spacing.sm },
  removeBtn: { padding: spacing.sm },
  rowTextWrap: { flex: 1 },
  rowSub: { ...typography.metadata, color: colors.textSecondary },
  listHeading: {
    ...typography.metadata,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  submitButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.subscribeBackground,
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
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  undoText: { flex: 1, color: colors.subscribeText, fontSize: 14 },
  undoAction: { color: colors.undoLink, fontSize: 14, fontWeight: '700' },
});
