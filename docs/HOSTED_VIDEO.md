# Hosted Video (Dual-Source) — Architecture, Setup, Costs, Limits

Status: **code complete on `feature/hosted-video`; NOT live.** No R2
bucket exists yet, migration 0005 is not applied, and the Edge
Functions are not deployed. Until the blocked user actions at the
bottom are done, every hosted path in the app answers honestly with
"Hosted playback is not configured yet" (`R2_NOT_CONFIGURED`).

## 1. Architecture

The app stays one app with two media sources, chosen per video row
(`videos.source`, migration `0006_hosted_videos.sql`):

| | `source='youtube'` (default, unchanged) | `source='hosted'` |
|---|---|---|
| Media | YouTube's servers | Original file in Cloudflare R2 |
| Player | Official YouTube embed only (branding/controls untouched, ≥200×200) | `HostedPlayer` (`expo-video`: Media3 / AVPlayer / HTML5+hls.js) with our own controls |
| Identity | `youtube_video_id` (NOT NULL by check) | `youtube_video_id` is NULL; media in `hosted_assets` |
| Playback URL | Embed URL | Short-lived (≤15 min) signed GET, minted per play by `r2-playback` for signed-in members only |

**Source rule (absolute).** Hosted files are originals supplied by
the rights holder only. Nothing downloads, scrapes or extracts a
YouTube stream — there is no code path in this repo that can turn a
YouTube video into a hosted file.

**Structural publish gate.** A BEFORE INSERT/UPDATE trigger on
`videos` (`videos_hosted_publish_gate`) raises unless a
`content_authorizations` row exists for the video. No client — app,
admin UI, dashboard, raw API — can publish an unauthorized hosted
recording. The admin UI mirrors the gate (Publish disabled, reason
shown) but the trigger is the enforcement.

**Data model (0005).** `videos.source` + nullable `youtube_video_id`
(Postgres UNIQUE treats NULLs as distinct, so YouTube ids stay unique
and hosted rows coexist) + a CHECK tying source to id presence.
`hosted_assets` (one per video: R2 keys — never URLs — status
`uploaded/processing/ready/failed`, rotation window
`publish_at/expires_at`, `replacement_of`). `content_authorizations`
(admin-only RLS; members have no access at all). `hosted_assets` is
member-readable only for published hosted videos. All admin actions
write the existing `audit_logs` table.

**Edge Functions** (`supabase/functions/`, Deno, SigV4 implemented by
hand with WebCrypto in `_shared/s3.ts` — no external deps, no secrets
in code):

- `r2-upload` (admin): `presign-put` / `create-multipart` /
  `sign-part` / `complete` / `abort`. Keys restricted to `hosted/`.
- `r2-playback` (member): re-checks source, publish state, asset
  `ready`, and authorization existence, then signs the HLS master
  (900 s). Can also sign one extra object strictly under the video's
  own asset prefix.
- `r2-admin` (admin): `delete` / `replace` with the safety rules in
  §4; audit-logs every action.
- `r2-rotate` (cron secret or admin): runs
  `hosted_rotation_candidates()`, applies the shared rotation routine
  (`_shared/rotate.ts`), reports rotated/skipped per asset.

**App.** `WatchScreen` renders `HostedWatchPlayer` (mints the URL,
honest loading/error states) for hosted rows and the official embed
otherwise. `SessionWatchScreen` renders `HostedPlayer` directly with
the session sync: hosted sessions use the tighter drift rule (check
every 10 s, correct at >1.5 s — native seeks are precise) while
YouTube sessions keep 5 s / 5 s; the scrubber is hidden while a
hosted session is NOW PLAYING and shown for COMPLETED replay.
Labels remain exactly UPCOMING / NOW PLAYING / COMPLETED.

**Admin** (`Admin → Hosted videos`): create draft → record
authorization (required) → upload original (web admin; single PUT
≤64 MB, multipart 16 MB parts above; progress shown) → transcode via
the laptop pipeline → set HLS master key → mark ready → publish.
Rotation fields (`publish_at`, `expires_at`, `replacement_of`) and
R2 delete/replace actions live on the same screen. On native, the
upload section honestly says to use the web admin.

## 2. Transcoding pipeline (laptop, free)

```bash
ffmpeg -i original.mp4 -vf scale=-2:480 \
  -c:v libx264 -preset veryfast -b:v 800k \
  -force_key_frames "expr:gte(t,n_forced*6)" \
  -c:a aac -b:a 96k -hls_time 6 -hls_list_size 0 \
  -hls_segment_filename "hls/seg_%03d.ts" hls/master.m3u8
# then upload the whole hls/ directory next to the original's key:
rclone copy hls/ r2:<bucket>/hosted/<video-id>/hls/
```

`-force_key_frames` matters: without it, segments split only at
natural keyframes (our first proof run produced 8.33 s segments
instead of 6 s).

## 3. Pipeline proof — REAL numbers (self-owned test recording)

Proven 2026-11-27 on this VM with ffmpeg 8.1.2, using a recording we
own outright: a generated 20 s 854×480 testsrc2 + 440 Hz sine file
with a burned-in slate "Hosted pipeline test — self-owned recording"
(`/tmp/hosted-test/`, asserted by `scripts/verify-hosted.mjs`).

| Measure | Value |
|---|---|
| Source | 20.0 s, 3,295,491 bytes |
| HLS output (800k video + 96k audio) | 2,363,740 bytes total |
| Segments | 4 × `.ts`, exactly 6 s each (with forced keyframes) |
| Transcode wall time | 3.95 s for 20 s of content (~5× realtime, this VM) |
| Extrapolated size | ~403 MB/hour at these settings → **~24 hours** in the 10 GB free tier; at 600k video ≈ ~315 MB/hr → ~31 hours |

No live R2 upload or playback is claimed — none is possible until §6
is done.

## 4. Rotation safety rules

An expired asset is rotated only when ALL hold (checked in SQL for
candidacy and re-checked in the function at action time): a
replacement asset exists and is `ready`; the video is not referenced
by any session with status `upcoming`/`now_playing`. The swap is
publish-state based and ordered DB-first (the publish gate can still
refuse a replacement that lacks authorization — then nothing is
deleted), then R2 objects are deleted, then the old asset row is
removed; every step is audit-logged. `r2-admin delete` additionally
refuses to remove the only ready copy without
`confirm_only_copy=true`. **Nothing auto-deletes in SQL**;
`hosted_rotation_candidates()` only lists. Scheduling via pg_cron is
provided as a commented, complete block in migration 0005 — the cron
target is the `r2-rotate` function (it owns the R2 credentials), not
SQL.

## 5. Cost estimate (verified against provider pages, 2026-11-27)

| Item | Free allowance | Beyond |
|---|---|---|
| Cloudflare R2 storage | 10 GB-month | $0.015 / GB-month |
| R2 Class A ops (writes/lists) | 1M / month | $4.50 / million |
| R2 Class B ops (reads) | 10M / month | $0.36 / million |
| R2 egress | **Free, unlimited** | — |
| Supabase (existing project) | 500 MB DB, 200 Realtime connections, unchanged | — |
| ffmpeg / rclone | Free (own laptop) | Your time (~0.2–2× runtime per video) |

A 2-hour samagam is ~1,200 segment GETs per viewer; 30 members
watching in sync ≈ 36–70k Class B ops — far inside the free tier.
**The only cost gate is the card on file**: Cloudflare requires a
payment method to activate R2 even on the free tier (₹0 is charged
inside the tier; overage auto-bills slowly if the library outgrows
10 GB — 100 GB ≈ $1.35/month).

## 6. BLOCKED — user actions required before any of this goes live

1. **Cloudflare account + card on file** to activate the R2 free
   tier; create one bucket (e.g. `haftawari-hosted`).
2. **Bucket CORS** for browser uploads/playback: allow `PUT, GET`
   from the app origins, expose `ETag`.
3. **R2 API token** (S3 credentials) for the bucket.
4. **Apply migration 0005** in the Supabase SQL editor.
   ⚠️ NUMBERING COLLISION: Phase 13 on master added its own
   `0005_video_comments.sql` after this branch forked. When this
   branch is merged, rename this file to `0006_hosted_videos.sql`
   (contents unchanged) before applying.
5. **Deploy the Edge Functions** and set their secrets:
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`, and `CRON_SECRET` (for `r2-rotate`). Secrets are read
   from `Deno.env` only — never commit them.
6. **Rights-holder permission + first original file** before any real
   recording is uploaded (the publish gate will block publishing
   without the authorization record in any case).

## 7. Honest limitations

- **Upload validation — enforced server-side (not advisory).**
  The `r2-upload` Edge Function is the enforcement point; the UI
  only mirrors it:
  - **MIME allowlist:** only `video/mp4`, `video/webm` and
    `video/quicktime` may be signed for upload (`presign-put` /
    `create-multipart`). Anything else — including a missing
    content type — is refused with `400 UNSUPPORTED_MEDIA_TYPE`.
  - **Size cap:** one original may be at most **8 GiB**
    (`MAX_OBJECT_BYTES`). A declared `size_bytes` over the cap is
    refused at signing time (`413 FILE_TOO_LARGE`); that check is
    advisory only, because a client can lie about its own file.
  - **Verify-before-ready (the hard check):** an asset may be
    marked `ready` only after the admin UI runs the signer's
    `verify-object` action, which HEADs the object in R2
    (`headObject` in `_shared/s3.ts`) and checks the
    **server-measured** facts: missing object →
    `404 OBJECT_NOT_FOUND`; measured size over the cap → `413`;
    stored content type present and not allowlisted → `400`.
    On success the asset row's `size_bytes` (and `content_type`
    when R2 reports one) are overwritten with the measured values —
    client-claimed size/type never survive to `ready`. If
    verification fails, the status change is refused and the error
    is shown to the admin.
  - **Content signature (magic bytes):** HEAD metadata can claim
    any type, so `verify-object` additionally fetches the object's
    first 32 bytes (Range GET on a short-lived presigned URL) and
    checks the signature against the type: MP4/QuickTime must carry
    the ISO-BMFF `ftyp` box at bytes 4–8; WebM must start with the
    EBML header `1A 45 DF A3`. A mismatch is refused with
    `400 CONTENT_SIGNATURE_MISMATCH`; if the bytes cannot be
    fetched at all, verification fails (`502
    CONTENT_SIGNATURE_CHECK_FAILED`) — it never passes silently.
    When R2 reports no content type, any one known video signature
    is accepted; an unrecognized header still fails.
  - **Function-side audit trail:** `r2-upload` itself appends
    `audit_logs` entries for a completed multipart upload
    (`hosted.upload_completed`) and a successful verification
    (`hosted.object_verified`, with the measured size/type), actor
    = the calling admin. These writes are best-effort: an audit
    failure never changes the function's response.
  - What this does NOT prove: that the bytes beyond the header are
    a playable, untampered video (no full-file checksum/transcode
    verification yet), or anything about HLS segment objects —
    verification covers the uploaded original only.
- **HLS segment signing.** A signed master playlist does not by
  itself make segments private: the player requests segments by
  relative URL, unsigned. What is guaranteed today: no public or
  permanent URLs, links expire in ≤15 min, only members can mint
  one. True per-object enforcement needs an authorizing layer in
  front of the bucket (e.g. a Cloudflare Worker checking a token) —
  not built; the `r2.dev` public endpoint must stay disabled.
- **Web HLS** goes through expo-video's web implementation
  (HTML5 + hls.js where the browser lacks native HLS); Safari is
  native. Device/PWA verification is still owed once R2 exists.
- **Upload is web-admin-first** by design; the native admin shows an
  honest pointer to the web dashboard.
- **Signed URLs expire in 15 min**: a paused-for-longer viewing may
  need a fresh mint on resume; the player surfaces the resulting
  error honestly rather than looping silently.
- **expo-video's config plugin** was added with defaults; background
  playback / PiP entitlements for hosted content were NOT enabled
  (separate decision + native rebuild).
- Migration 0005 has not been run against the live database from
  this branch; SQL was reviewed statically and by the verify script,
  not executed.
