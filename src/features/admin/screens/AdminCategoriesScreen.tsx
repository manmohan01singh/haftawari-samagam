import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { lightColors, radii, spacing, typography } from '../../../theme';
import type { Category } from '../../../types/database';
import {
  createCategory,
  deleteCategory,
  listCategories,
  moveCategory,
  renameCategory,
  slugifyCategoryName,
} from '../adminService';
import { AdminGate, type AdminContext } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  ConfirmButton,
  ErrorBanner,
  LoadingView,
  SectionTitle,
  adminStyles,
} from '../components/AdminUi';

function CategoriesContent({ ctx }: { ctx: AdminContext }) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setCategories(await listCategories());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createCategory(name, ctx.userId);
      setCategories((prev) => [...(prev ?? []), created]);
      setNewName('');
      setNotice(`Category created: ${created.name} (${created.slug})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const onRename = async (category: Category) => {
    const name = editName.trim();
    if (!name) return;
    setBusyId(category.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await renameCategory(category, name, ctx.userId);
      setCategories((prev) => (prev ?? []).map((c) => (c.id === updated.id ? updated : c)));
      setEditingId(null);
      setNotice(`Renamed to "${updated.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onMove = async (index: number, direction: -1 | 1) => {
    const list = categories ?? [];
    const category = list[index];
    const neighbour = list[index + direction];
    if (!category || !neighbour) return;
    setBusyId(category.id);
    setError(null);
    setNotice(null);
    try {
      await moveCategory(category, neighbour, ctx.userId);
      // Apply the swapped sort_order values locally, then re-sort for display.
      const reordered = list.map((c) => {
        if (c.id === category.id) return { ...c, sort_order: neighbour.sort_order };
        if (c.id === neighbour.id) return { ...c, sort_order: category.sort_order };
        return c;
      });
      reordered.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      setCategories(reordered);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (category: Category) => {
    setBusyId(category.id);
    setError(null);
    setNotice(null);
    try {
      await deleteCategory(category, ctx.userId);
      setCategories((prev) => (prev ?? []).filter((c) => c.id !== category.id));
      setNotice(
        `Deleted "${category.name}". Videos in it are kept and become uncategorised.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminScroll>
      <View style={styles.form}>
        <SectionTitle>New category</SectionTitle>
        <TextInput
          style={adminStyles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="e.g. Haftawari, Amritvela, Evening Kirtan"
          placeholderTextColor={lightColors.textSecondary}
        />
        {newName.trim() ? (
          <Text style={styles.help}>Slug: {slugifyCategoryName(newName) || '—'}</Text>
        ) : null}
        <AdminButton
          title={creating ? 'Creating…' : 'Create category'}
          variant="primary"
          disabled={creating || !newName.trim()}
          onPress={onCreate}
        />
      </View>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.listHeader}>
        <SectionTitle>Categories ({categories?.length ?? 0})</SectionTitle>
        <AdminButton title="Refresh" onPress={load} />
      </View>

      {categories == null ? (
        <LoadingView label="Loading categories…" />
      ) : categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          message="Create the first shelf category above — for example Haftawari or Amritvela."
        />
      ) : (
        categories.map((category, index) => {
          const busy = busyId === category.id;
          const editing = editingId === category.id;
          return (
            <View key={category.id} style={styles.card}>
              <View style={styles.cardText}>
                <Text style={styles.name}>{category.name}</Text>
                <Text style={styles.meta}>
                  slug: {category.slug} · order {category.sort_order}
                </Text>
              </View>
              {editing ? (
                <View style={styles.editBox}>
                  <TextInput
                    style={adminStyles.input}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="New name"
                    placeholderTextColor={lightColors.textSecondary}
                  />
                  <Text style={styles.help}>
                    Only the display name changes — the slug stays &quot;{category.slug}&quot;
                    so existing links and shelves keep working.
                  </Text>
                  <View style={styles.actions}>
                    <AdminButton
                      title="Save name"
                      variant="primary"
                      disabled={busy || !editName.trim()}
                      onPress={() => void onRename(category)}
                    />
                    <AdminButton title="Cancel" disabled={busy} onPress={() => setEditingId(null)} />
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  <AdminButton
                    title="↑"
                    disabled={busy || index === 0}
                    onPress={() => void onMove(index, -1)}
                  />
                  <AdminButton
                    title="↓"
                    disabled={busy || index === categories.length - 1}
                    onPress={() => void onMove(index, 1)}
                  />
                  <AdminButton
                    title="Rename"
                    disabled={busy}
                    onPress={() => {
                      setEditingId(category.id);
                      setEditName(category.name);
                    }}
                  />
                  <ConfirmButton
                    title="Delete"
                    confirmTitle="Tap again to delete"
                    disabled={busy}
                    onConfirm={() => void onDelete(category)}
                  />
                </View>
              )}
            </View>
          );
        })
      )}
    </AdminScroll>
  );
}

/** Admin — Categories: create, rename, reorder, delete archive categories. */
export function AdminCategoriesScreen() {
  return <AdminGate>{(ctx) => <CategoriesContent ctx={ctx} />}</AdminGate>;
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  help: { ...typography.body, color: lightColors.textSecondary },
  notice: { ...typography.body, color: '#1B5E20' },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  card: {
    borderWidth: 1,
    borderColor: lightColors.border,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: lightColors.surface,
  },
  cardText: { gap: spacing.xs },
  name: { ...typography.cardTitle, color: lightColors.text },
  meta: { ...typography.metadata, color: lightColors.textSecondary },
  editBox: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
