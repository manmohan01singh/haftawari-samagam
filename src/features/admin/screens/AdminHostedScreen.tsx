import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState } from '../../../components/common/EmptyState';
import { radii, spacing, typography, useTheme, type ThemeColors } from '../../../theme';
import type { HostedAsset, Video } from '../../../types/database';
import {
  createHostedVideoDraft,
  createSession,
  invokeR2Admin,
  listHostedVideoBundles,
  saveContentAuthorization,
  setVideoDuration,
  setVideoPublishState,
  setVideoThumbnail,
  updateHostedAsset,
  upsertHostedAsset,
  verifyHostedAsset,
  type HostedVideoBundle,
} from '../adminService';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';
import { probeVideoDuration } from '../../hosted/hostedProbe';
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

  // Simplified permission step (user request, 27 Nov 2026): ONE
  // confirmation + an optional note. The database publish gate still
  // requires the recorded authorization row — this only removes the
  // four-field form, not the record itself.
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [permissionNote, setPermissionNote] = useState('');
  const [savingAuthz, setSavingAuthz] = useState(false);

  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Inline scheduling (step 5): date/time text fields, same pattern
  // as the Sessions admin — defaults to today at 16:00.
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sessionTime, setSessionTime] = useState('16:00');
  const [sessionDurationMin, setSessionDurationMin] = useState('');
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
      if (!permissionConfirmed) {
        throw new Error('Tick the confirmation first — publishing stays locked without it.');
      }
      await saveContentAuthorization(
        video.id,
        {
          rightsHolder: 'Rights holder (confirmed by admin)',
          permissionNote:
            permissionNote.trim() || 'Permission confirmed by the admin in the app.',
          permissionReference: null,
          permissionDate: new Date().toISOString().slice(0, 10),
        },
        ctx.userId,
      );
      setPermissionConfirmed(false);
      setPermissionNote('');
    }, 'Permission recorded. Publishing is now unlocked for this recording.');

  /**
   * Persist a probed duration (see hostedProbe): writes the video
   * row's duration_seconds and pre-fills the schedule duration, so a
   * session of this recording ends — and late joiners clamp — at the
   * true end. Best-effort: a failed probe never blocks the upload.
   */
  const persistProbedDuration = async (seconds: number | null) => {
    if (seconds == null || seconds <= 0) return;
    try {
      await setVideoDuration(video.id, seconds, ctx.userId);
      setSessionDurationMin((current) =>
        current.trim() ? current : String(Math.max(1, Math.ceil(seconds / 60))),
      );
    } catch {
      // The upload itself already succeeded; duration can also be
      // healed later by probe-on-first-play (admin watching).
    }
  };

  const onFilePicked = async (file: File) => {
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_');
    const key = `hosted/${video.id}/${safeName}`;
    setBusy(true);
    onError(null);
    onNotice(null);
    setUploadPct(0);
    try {
      const objectUrl = URL.createObjectURL(file);
      const probed = await probeVideoDuration(objectUrl).catch(() => null);
      URL.revokeObjectURL(objectUrl);
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
      await persistProbedDuration(probed);
      onNotice('Original uploaded. Now tap "Verify & make ready" below.');
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

  // Native (phone) upload — the admin's primary path (user request,
  // 27 Nov 2026: uploads must work from the mobile app itself, not
  // only from a web dashboard on a computer).
  const pickFileNative = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['video/mp4', 'video/webm', 'video/quicktime'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const picked = result.assets[0];
    const safeName = picked.name.replace(/[^A-Za-z0-9._-]+/g, '_');
    const key = `hosted/${video.id}/${safeName}`;
    setBusy(true);
    onError(null);
    onNotice(null);
    setUploadPct(0);
    try {
      // Probe the file's real duration on-device BEFORE the upload —
      // the session engine needs it and the server cannot measure it.
      const probed = await probeVideoDuration(picked.uri).catch(() => null);
      await uploadOriginalToR2(
        {
          uri: picked.uri,
          name: picked.name,
          mimeType: picked.mimeType ?? null,
          size: picked.size ?? 0,
        },
        key,
        (p) => setUploadPct(Math.floor((p.loadedBytes / Math.max(1, p.totalBytes)) * 100)),
      );
      await upsertHostedAsset(
        video.id,
        {
          r2ObjectKey: key,
          originalFilename: picked.name,
          contentType: picked.mimeType ?? null,
          sizeBytes: picked.size ?? null,
        },
        ctx.userId,
      );
      await persistProbedDuration(probed);
      onNotice('Original uploaded. Now tap "Verify & make ready" below.');
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

  // ONE ready step (simplified flow): the server verifies the
  // uploaded object in R2 (existence, measured size, media type,
  // file signature), then the asset is marked ready as a DIRECT-FILE
  // asset — its playback key is the original file itself, so no HLS
  // transcode or manual key entry is needed. r2-playback signs that
  // single object for members; r2-admin's delete path already treats
  // hls_master_key === r2_object_key as the same object.
  const onVerifyAndReady = () =>
    run(async () => {
      if (!asset) throw new Error('Upload the original file first.');
      await verifyHostedAsset(asset.id, ctx.userId);
      await updateHostedAsset(
        asset,
        { status: 'ready', hlsMasterKey: asset.r2_object_key },
        ctx.userId,
      );
    }, 'Verified in R2 and marked ready. You can publish now.');

  const onScheduleSession = () =>
    run(async () => {
      const start = new Date(`${sessionDate.trim()}T${sessionTime.trim()}:00`);
      if (Number.isNaN(start.getTime())) {
        throw new Error('Enter the date as YYYY-MM-DD and the time as HH:MM (24-hour).');
      }
      // Window end: the typed minutes win; otherwise the recording's
      // own probed duration — a session scheduled without any end is
      // what used to sit at NOW PLAYING long past the video's end.
      const durationMin = sessionDurationMin.trim()
        ? Number(sessionDurationMin.trim())
        : video.duration_seconds
          ? Math.ceil(video.duration_seconds / 60)
          : null;
      const end =
        durationMin && durationMin > 0
          ? new Date(start.getTime() + durationMin * 60_000)
          : null;
      await createSession(
        {
          videoId: video.id,
          title: null,
          scheduledStartAt: start.toISOString(),
          scheduledEndAt: end ? end.toISOString() : null,
        },
        ctx.userId,
      );
    }, `Session scheduled for ${sessionDate.trim()} at ${sessionTime.trim()} — it will show as UPCOMING, then NOW PLAYING at that time.`);

  // Thumbnail upload (user request, 27 Nov 2026): hosted videos have
  // no YouTube thumbnail to borrow, so without one every card renders
  // black. The picked image is compressed to a small JPEG and stored
  // on the video row as a data URI (the catalogue holds essentially
  // one hosted video at a time — no separate image host needed).
  const pickThumbnail = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onError('Photo access is needed to choose a thumbnail.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await run(async () => {
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 640 } }],
        { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('Could not process that image.');
      await setVideoThumbnail(
        video.id,
        `data:image/jpeg;base64,${manipulated.base64}`,
        ctx.userId,
      );
    }, 'Thumbnail saved — cards for this recording will show it everywhere.');
  };

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

      {/* ── Permission (the publish gate, one-tap form) ── */}
      <Text style={styles.subhead}>1 · Permission (required to publish)</Text>
      {bundle.authorizations.map((a) => (
        <Text key={a.id} style={styles.meta}>
          {a.rights_holder} · {a.permission_date}
          {a.permission_reference ? ` · ${a.permission_reference}` : ''}
        </Text>
      ))}
      {hasAuthorization ? (
        <Text style={styles.help}>Permission is recorded — publishing is unlocked.</Text>
      ) : (
        <>
          <AdminButton
            title={
              permissionConfirmed
                ? '☑ I have the rights holder\u2019s permission for this recording'
                : '☐ I have the rights holder\u2019s permission for this recording'
            }
            variant={permissionConfirmed ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => setPermissionConfirmed((v) => !v)}
          />
          <TextInput style={adminStyles.input} value={permissionNote} onChangeText={setPermissionNote} placeholder="Note (optional — who gave permission, when)" placeholderTextColor={colors.textSecondary} />
          <AdminButton
            title={savingAuthz ? 'Saving…' : 'Save permission'}
            variant="primary"
            disabled={savingAuthz || busy || !permissionConfirmed}
            onPress={() => {
              setSavingAuthz(true);
              void onSaveAuthorization().finally(() => setSavingAuthz(false));
            }}
          />
        </>
      )}

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
        <AdminButton
          title={uploadPct != null ? `Uploading… ${uploadPct}%` : asset ? 'Upload a new original' : 'Choose video file from this phone & upload'}
          variant="primary"
          disabled={busy || uploadPct != null}
          onPress={() => void pickFileNative()}
        />
      )}

      {/* ── Thumbnail (hosted videos have no YouTube thumb) ── */}
      <Text style={styles.subhead}>Thumbnail</Text>
      {video.thumbnail_url ? (
        <Image
          source={{ uri: video.thumbnail_url }}
          style={styles.thumbPreview}
          contentFit="cover"
        />
      ) : (
        <Text style={styles.help}>
          No thumbnail yet — without one, this recording&apos;s cards render black in the app.
        </Text>
      )}
      <View style={styles.actions}>
        <AdminButton
          title={video.thumbnail_url ? 'Change thumbnail' : 'Upload thumbnail'}
          disabled={busy}
          onPress={() => void pickThumbnail()}
        />
      </View>

      {/* ── Make ready (direct-file: no transcode step) ── */}
      <Text style={styles.subhead}>3 · Make ready</Text>
      <Text style={styles.help}>
        One tap: the server checks the uploaded file in Cloudflare (real video, size, type) and
        marks it ready to publish. The file plays as-is in the app&apos;s own player — no extra
        conversion step.
      </Text>
      <View style={styles.actions}>
        <AdminButton
          title={asset?.status === 'ready' ? 'Ready ✓ (verify again)' : 'Verify & make ready'}
          variant="primary"
          disabled={busy || !asset}
          onPress={onVerifyAndReady}
        />
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

      {/* ── Schedule the Samagam (goes live on its own) ── */}
      <Text style={styles.subhead}>5 · Schedule the Samagam</Text>
      {video.publish_state === 'published' ? (
        <>
          <Text style={styles.help}>
            Set the day and time once — at that time the recording starts for everyone as NOW
            PLAYING, with live chat and the real sangat count. You do not need to be here when it
            starts.
          </Text>
          <TextInput style={adminStyles.input} value={sessionDate} onChangeText={setSessionDate} placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.textSecondary} autoCapitalize="none" />
          <TextInput style={adminStyles.input} value={sessionTime} onChangeText={setSessionTime} placeholder="Start time (HH:MM, 24-hour)" placeholderTextColor={colors.textSecondary} autoCapitalize="none" />
          <TextInput style={adminStyles.input} value={sessionDurationMin} onChangeText={setSessionDurationMin} placeholder="Duration in minutes (optional — e.g. 135)" placeholderTextColor={colors.textSecondary} keyboardType="numeric" />
          <AdminButton title="Schedule Samagam session" variant="primary" disabled={busy} onPress={onScheduleSession} />
        </>
      ) : (
        <Text style={styles.help}>Publish first (step 4) — then you can schedule the Samagam from here.</Text>
      )}

      {/* ── R2 danger zone ── */}
      <Text style={styles.subhead}>6 · Storage actions (R2)</Text>
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
    thumbPreview: { width: 160, aspectRatio: 16 / 9, borderRadius: radii.card },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
    pickerOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  });
