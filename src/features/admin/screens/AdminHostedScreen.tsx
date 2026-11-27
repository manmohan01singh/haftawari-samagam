import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import type { HostedAsset, Video } from '../../../types/database';
import {
  createHostedVideoDraft,
  invokeR2Admin,
  listHostedVideoBundles,
  saveContentAuthorization,
  setVideoPublishState,
  updateHostedAsset,
  upsertHostedAsset,
  verifyHostedAsset,
  type HostedVideoBundle,
} from '../adminService';
import { AdminGate, type AdminContext } from '../components/AdminGate';
import {
  AdminButton,
  AdminScroll,
  Chip,
  ConfirmButton,
  ErrorBanner,
  LoadingView,
  SectionTitle,
  createAdminStyles,
  formatDuration,
  friendlyError,
  publishStateChip,
} from '../components/AdminUi';
import { uploadOriginalToR2 } from '../../hosted/hostedUpload';
import { HostedNotConfiguredError } from '../../hosted/hostedService';

/** Show gate/rotation errors verbatim — their wording IS the explanation. */
function displayError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (
    raw.includes('cannot be published') ||
    raw.includes('R2_NOT_CONFIGURED') ||
    raw.includes('ONLY_READY_COPY') ||
    raw.includes('ASSET_IN_ACTIVE_SESSION') ||
    raw.includes('NO_READY_REPLACEMENT') ||
    raw.includes('OBJECT_NOT_FOUND') ||
    raw.includes('FILE_TOO_LARGE') ||
    raw.includes('UNSUPPORTED_MEDIA_TYPE') ||
    raw.includes('CONTENT_SIGNATURE_MISMATCH') ||
    raw.includes('CONTENT_SIGNATURE_CHECK_FAILED') ||
    raw.includes('Verification failed')
  ) {
    return raw;
  }
  return friendlyError(err);
}

function HostedContent({ ctx }: { ctx: AdminContext }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [bundles, setBundles] = useState<HostedVideoBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setBundles(await listHostedVideoBundles());
    } catch (err) {
      setError(displayError(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onCreate = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const video = await createHostedVideoDraft(
        { title: title.trim(), description: description.trim() || null },
        ctx.userId,
      );
      setTitle('');
      setDescription('');
      setNotice(`Draft created: "${video.title}". Record the authorization, then upload the original file.`);
      setSelectedId(video.id);
      await load();
    } catch (err) {
      setError(displayError(err));
    } finally {
      setCreating(false);
    }
  };

  const selected = bundles?.find((b) => b.video.id === selectedId) ?? null;
  const allAssets: HostedAsset[] = (bundles ?? []).flatMap((b) => (b.asset ? [b.asset] : []));

  return (
    <AdminScroll>
      <View style={styles.box}>
        <SectionTitle>Hosted recordings (own files)</SectionTitle>
        <Text style={styles.help}>
          Hosted videos are ORIGINAL files supplied by the rights holder — never downloaded from
          YouTube. A hosted video cannot be published until the rights holder&apos;s permission is
          recorded below; the database itself enforces that gate. Playback uses short-lived signed
          URLs for signed-in members only.
        </Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Recording title (as the channel published it)"
          placeholderTextColor={colors.textSecondary}
        />
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor={colors.textSecondary}
        />
        <AdminButton
          title={creating ? 'Creating…' : 'Create hosted draft'}
          variant="primary"
          disabled={creating || !title.trim()}
          onPress={onCreate}
        />
      </View>

      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <SectionTitle>Hosted library ({bundles?.length ?? 0})</SectionTitle>
      {bundles == null ? (
        <LoadingView label="Loading hosted videos…" />
      ) : bundles.length === 0 ? (
        <EmptyState
          title="No hosted recordings yet"
          message="Create a draft above once you have the rights holder's permission and the original file."
        />
      ) : (
        bundles.map((bundle) => {
          const chip = publishStateChip(bundle.video.publish_state);
          const isSelected = bundle.video.id === selectedId;
          return (
            <View key={bundle.video.id} style={styles.card}>
              <View style={styles.cardText}>
                <Text style={styles.title} numberOfLines={2}>
                  {bundle.video.title}
                </Text>
                <Text style={styles.meta}>
                  Asset: {bundle.asset ? bundle.asset.status : 'none'} · Authorization:{' '}
                  {bundle.authorizations.length > 0 ? 'recorded' : 'MISSING'}
                </Text>
                <Chip label={chip.label} tone={chip.tone} />
              </View>
              <AdminButton
                title={isSelected ? 'Close' : 'Manage'}
                variant={isSelected ? 'primary' : 'secondary'}
                onPress={() => setSelectedId(isSelected ? null : bundle.video.id)}
              />
            </View>
          );
        })
      )}

      {selected ? (
        <ManagePanel
          key={selected.video.id}
          ctx={ctx}
          bundle={selected}
          allAssets={allAssets}
          onChanged={load}
          onError={setError}
          onNotice={setNotice}
        />
      ) : null}
    </AdminScroll>
  );
}

function ManagePanel({
  ctx,
  bundle,
  allAssets,
  onChanged,
  onError,
  onNotice,
}: {
  ctx: AdminContext;
  bundle: HostedVideoBundle;
  allAssets: HostedAsset[];
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const adminStyles = useMemo(() => createAdminStyles(colors), [colors]);
  const video: Video = bundle.video;
  const asset = bundle.asset;
  const hasAuthorization = bundle.authorizations.length > 0;

  const [rightsHolder, setRightsHolder] = useState('');
  const [permissionNote, setPermissionNote] = useState('');
  const [permissionReference, setPermissionReference] = useState('');
  const [permissionDate, setPermissionDate] = useState('');
  const [savingAuthz, setSavingAuthz] = useState(false);

  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [hlsKey, setHlsKey] = useState(asset?.hls_master_key ?? '');
  const [durationText, setDurationText] = useState(
    asset?.duration_seconds != null ? String(asset.duration_seconds) : '',
  );
  const [publishAt, setPublishAt] = useState(asset?.publish_at ?? '');
  const [expiresAt, setExpiresAt] = useState(asset?.expires_at ?? '');
  const [replacementOf, setReplacementOf] = useState<string | null>(asset?.replacement_of ?? null);
  const [busy, setBusy] = useState(false);
  const [onlyCopyWarning, setOnlyCopyWarning] = useState(false);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    onError(null);
    onNotice(null);
    try {
      await action();
      onNotice(done);
      await onChanged();
    } catch (err) {
      onError(displayError(err));
    } finally {
      setBusy(false);
    }
  };

  const onSaveAuthorization = () =>
    run(async () => {
      await saveContentAuthorization(
        video.id,
        {
          rightsHolder: rightsHolder.trim(),
          permissionNote: permissionNote.trim(),
          permissionReference: permissionReference.trim() || null,
          permissionDate: permissionDate.trim(),
        },
        ctx.userId,
      );
      setRightsHolder('');
      setPermissionNote('');
      setPermissionReference('');
      setPermissionDate('');
    }, 'Authorization recorded. Publishing is now unlocked for this recording.');

  const onFilePicked = async (file: File) => {
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_');
    const key = `hosted/${video.id}/${safeName}`;
    setBusy(true);
    onError(null);
    onNotice(null);
    setUploadPct(0);
    try {
      await uploadOriginalToR2(file, key, (p) =>
        setUploadPct(Math.floor((p.loadedBytes / Math.max(1, p.totalBytes)) * 100)),
      );
      await upsertHostedAsset(
        video.id,
        {
          r2ObjectKey: key,
          originalFilename: file.name,
          contentType: file.type || null,
          sizeBytes: file.size,
        },
        ctx.userId,
      );
      onNotice('Original uploaded. Transcode it to HLS (see docs/HOSTED_VIDEO.md), then set the HLS master key and mark the asset ready.');
      await onChanged();
    } catch (err) {
      onError(
        err instanceof HostedNotConfiguredError
          ? 'Hosting is not configured yet (R2_NOT_CONFIGURED) — finish the Cloudflare R2 setup before uploading.'
          : displayError(err),
      );
    } finally {
      setUploadPct(null);
      setBusy(false);
    }
  };

  const pickFileWeb = () => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void onFilePicked(f);
    };
    input.click();
  };

  const onSaveAssetFields = () =>
    run(async () => {
      if (!asset) throw new Error('Upload the original file first.');
      await updateHostedAsset(
        asset,
        {
          hlsMasterKey: hlsKey.trim() || null,
          durationSeconds: durationText.trim() ? Number(durationText.trim()) : null,
          publishAt: publishAt.trim() || null,
          expiresAt: expiresAt.trim() || null,
          replacementOf,
        },
        ctx.userId,
      );
    }, 'Asset details saved.');

  const onSetStatus = (status: 'processing' | 'ready' | 'failed') =>
    run(async () => {
      if (!asset) throw new Error('Upload the original file first.');
      if (status === 'ready') {
        if (!hlsKey.trim()) {
          throw new Error('Set the HLS master playlist key before marking the asset ready.');
        }
        // Verify BEFORE ready: the server HEADs the object in R2 and
        // overwrites size/type with measured values. If the object is
        // missing, oversized or a disallowed type this throws, the
        // error shows above, and the status is NOT changed.
        await verifyHostedAsset(asset.id, ctx.userId);
      }
      await updateHostedAsset(
        asset,
        { status, hlsMasterKey: hlsKey.trim() || null },
        ctx.userId,
      );
    }, status === 'ready' ? 'Verified in R2 and marked ready.' : `Asset marked ${status}.`);

  const onDeleteAsset = (confirmOnlyCopy: boolean) =>
    run(async () => {
      if (!asset) throw new Error('There is no asset to delete.');
      try {
        await invokeR2Admin('delete', asset.id, confirmOnlyCopy);
        setOnlyCopyWarning(false);
      } catch (err) {
        if (!confirmOnlyCopy && err instanceof Error && err.message.includes('ONLY_READY_COPY')) {
          setOnlyCopyWarning(true);
        }
        throw err;
      }
    }, 'Asset deleted from R2 and removed.');

  const onReplaceAsset = () =>
    run(async () => {
      if (!asset) throw new Error('There is no asset to replace.');
      await invokeR2Admin('replace', asset.id);
    }, 'Replacement is now the active copy; the old files were deleted from R2.');

  return (
    <View style={styles.panel}>
      <SectionTitle>Manage: {video.title}</SectionTitle>

      {/* ── Authorization (the publish gate) ── */}
      <Text style={styles.subhead}>1 · Rights holder authorization (required to publish)</Text>
      {bundle.authorizations.map((a) => (
        <Text key={a.id} style={styles.meta}>
          {a.rights_holder} · {a.permission_date}
          {a.permission_reference ? ` · ${a.permission_reference}` : ''}
        </Text>
      ))}
      <TextInput style={adminStyles.input} value={rightsHolder} onChangeText={setRightsHolder} placeholder="Rights holder (e.g. channel name / sewadaar)" placeholderTextColor={colors.textSecondary} />
      <TextInput style={adminStyles.input} value={permissionNote} onChangeText={setPermissionNote} placeholder="Permission note (what was agreed, with whom)" placeholderTextColor={colors.textSecondary} />
      <TextInput style={adminStyles.input} value={permissionReference} onChangeText={setPermissionReference} placeholder="Reference (optional — message/email/file reference)" placeholderTextColor={colors.textSecondary} />
      <TextInput style={adminStyles.input} value={permissionDate} onChangeText={setPermissionDate} placeholder="Permission date (YYYY-MM-DD)" placeholderTextColor={colors.textSecondary} autoCapitalize="none" />
      <AdminButton
        title={savingAuthz ? 'Saving…' : 'Save authorization'}
        variant="primary"
        disabled={
          savingAuthz || busy || !rightsHolder.trim() || !permissionNote.trim() || !permissionDate.trim()
        }
        onPress={() => {
          setSavingAuthz(true);
          void onSaveAuthorization().finally(() => setSavingAuthz(false));
        }}
      />

      {/* ── Upload ── */}
      <Text style={styles.subhead}>2 · Original file</Text>
      {asset ? (
        <Text style={styles.meta}>
          {asset.original_filename ?? asset.r2_object_key} · {asset.status} ·{' '}
          {asset.size_bytes != null ? `${(asset.size_bytes / 1_000_000).toFixed(1)} MB` : 'size unknown'} ·{' '}
          {formatDuration(asset.duration_seconds)}
        </Text>
      ) : (
        <Text style={styles.meta}>No file uploaded yet.</Text>
      )}
      {Platform.OS === 'web' ? (
        <AdminButton
          title={uploadPct != null ? `Uploading… ${uploadPct}%` : asset ? 'Upload a new original' : 'Choose original file & upload'}
          variant="primary"
          disabled={busy || uploadPct != null}
          onPress={pickFileWeb}
        />
      ) : (
        <Text style={styles.help}>
          Uploads run from the web admin — open this dashboard in a browser on the computer that
          holds the original file.
        </Text>
      )}

      {/* ── HLS + rotation fields ── */}
      <Text style={styles.subhead}>3 · HLS + rotation</Text>
      <TextInput style={adminStyles.input} value={hlsKey} onChangeText={setHlsKey} placeholder="HLS master key (e.g. hosted/<id>/hls/master.m3u8)" placeholderTextColor={colors.textSecondary} autoCapitalize="none" autoCorrect={false} />
      <TextInput style={adminStyles.input} value={durationText} onChangeText={setDurationText} placeholder="Duration in seconds (optional)" placeholderTextColor={colors.textSecondary} keyboardType="numeric" />
      <TextInput style={adminStyles.input} value={publishAt} onChangeText={setPublishAt} placeholder="Publish at (ISO 8601, optional)" placeholderTextColor={colors.textSecondary} autoCapitalize="none" />
      <TextInput style={adminStyles.input} value={expiresAt} onChangeText={setExpiresAt} placeholder="Expires at (ISO 8601, optional — rotation)" placeholderTextColor={colors.textSecondary} autoCapitalize="none" />
      <Text style={styles.meta}>Replacement of (this asset replaces an older one):</Text>
      <View style={styles.pickerOptions}>
        {[null, ...allAssets.filter((a) => a.id !== asset?.id).map((a) => a.id)].map((id) => (
          <AdminButton
            key={id ?? 'none'}
            title={id == null ? 'None' : id.slice(0, 8)}
            variant={replacementOf === id ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => setReplacementOf(id)}
          />
        ))}
      </View>
      <View style={styles.actions}>
        <AdminButton title="Save asset details" disabled={busy || !asset} onPress={onSaveAssetFields} />
        <AdminButton title="Mark processing" disabled={busy || !asset} onPress={() => onSetStatus('processing')} />
        <AdminButton title="Mark ready" variant="primary" disabled={busy || !asset} onPress={() => onSetStatus('ready')} />
        <AdminButton title="Mark failed" disabled={busy || !asset} onPress={() => onSetStatus('failed')} />
      </View>

      {/* ── Publish ── */}
      <Text style={styles.subhead}>4 · Publish</Text>
      {!hasAuthorization ? (
        <Text style={styles.help}>
          Publishing is locked until an authorization is saved above — the database trigger will
          refuse it even if this button were enabled.
        </Text>
      ) : null}
      <View style={styles.actions}>
        {video.publish_state === 'published' ? (
          <AdminButton
            title="Unpublish"
            disabled={busy}
            onPress={() =>
              run(async () => {
                await setVideoPublishState(video, 'unpublished', ctx.userId);
              }, `Unpublished: "${video.title}"`)
            }
          />
        ) : (
          <AdminButton
            title="Publish"
            variant="primary"
            disabled={busy || !hasAuthorization}
            onPress={() =>
              run(async () => {
                await setVideoPublishState(video, 'published', ctx.userId);
              }, `Published: "${video.title}"`)
            }
          />
        )}
      </View>

      {/* ── R2 danger zone ── */}
      <Text style={styles.subhead}>5 · Storage actions (R2)</Text>
      <View style={styles.actions}>
        <AdminButton title="Rotate to ready replacement" disabled={busy || !asset} onPress={onReplaceAsset} />
        <ConfirmButton
          title="Delete asset from R2"
          confirmTitle="Tap again to delete from R2"
          disabled={busy || !asset}
          onConfirm={() => void onDeleteAsset(false)}
        />
      </View>
      {onlyCopyWarning ? (
        <View style={styles.actions}>
          <Text style={styles.help}>
            That was refused: this is the ONLY ready copy and no ready replacement exists.
          </Text>
          <ConfirmButton
            title="Delete the only copy anyway"
            confirmTitle="Tap again — really delete the only copy"
            disabled={busy}
            onConfirm={() => void onDeleteAsset(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Admin — Hosted: dual-source recordings with the structural publish gate. */
export function AdminHostedScreen() {
  return <AdminGate>{(ctx) => <HostedContent ctx={ctx} />}</AdminGate>;
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    box: { gap: spacing.md },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      ...typography.body,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    help: { ...typography.body, color: colors.textSecondary },
    notice: { ...typography.body, color: '#1B5E20' },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      padding: spacing.md,
      backgroundColor: colors.surface,
    },
    cardText: { flex: 1, gap: spacing.xs },
    title: { ...typography.cardTitle, color: colors.text },
    meta: { ...typography.metadata, color: colors.textSecondary },
    panel: {
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      padding: spacing.md,
      backgroundColor: colors.surface,
    },
    subhead: { ...typography.chip, color: colors.text, marginTop: spacing.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    pickerOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  });
