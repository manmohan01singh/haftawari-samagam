import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { lightColors, radii, spacing, typography } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

/**
 * Search entry (reference §3 search bar): back arrow, a light pill
 * field holding the query with a × clear inside its right end.
 * Submitting runs the real search (archive + official channel).
 */
export function SearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');

  const submit = () => {
    const q = query.trim();
    if (q) navigation.navigate('SearchResults', { query: q });
  };

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
            onSubmitEditing={submit}
            returnKeyType="search"
            autoFocus
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <MaterialIcons name="close" size={20} color={lightColors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={styles.hint}>
        Search the published archive and the official channel of Bhai Gursharan Singh Ji.
      </Text>
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
});
