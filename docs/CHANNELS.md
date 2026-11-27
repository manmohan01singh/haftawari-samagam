# Multi-Channel Panel (migration 0003)

The admin decides **which YouTube channels appear in the app**. Before
this feature the app was hard-wired to one channel (Bhai Gursharan
Singh Ji official). Now:

- **Admin → Channels** lists the panel, adds a channel by @handle /
  channel URL / UC… id (resolved through the YouTube Data API — the
  admin confirms the real title/avatar/counts before saving),
  activates/deactivates, reorders, refreshes metadata, and removes
  (two-tap confirm). Every mutation writes an `audit_logs` entry
  (`channel.add / .activate / .deactivate / .reorder / .refresh /
  .remove`) and all writes go through RLS (`public.is_admin()`).
- **Subscriptions** reads all ACTIVE channels: avatar rail (one entry
  per channel, red live dot only when YouTube reports that channel
  live), tap an avatar to filter the feed to that channel, tap again
  to open its Channel page, "All" merges every channel's uploads.
- **Search**: the channel card matches ANY active channel
  (title/handle/aliases from the table; the best match gets the ref-3
  card), and the YouTube video leg fans out across active channels.
- **Shorts are excluded everywhere** (same `isShortVideo` heuristic).
- **Live is never stored or faked**: live/upcoming state always comes
  from `search.list?eventType=` at read time.

## Fallback (pre-migration behaviour)

If the `channels` table does not exist yet, or Supabase is
unreachable/unconfigured, `fetchActiveChannels()` returns the single
original channel and the app behaves exactly as before. A successful
query returning zero active rows is honoured as "no channels" (the
admin's choice) and does NOT resurrect the fallback.

## Suggested presets

The admin screen offers one-tap lookups for channels resolved live via
the API on 2026-11-26 (suggestions only — nothing becomes active until
the admin confirms the fresh lookup and taps Add):

| Channel | ID | Handle | Subs (26 Nov 2026) |
|---|---|---|---|
| AMRITVELA TRUST LIVE | `UCsWEj3uf31iAF_STEvO3A2A` | `@amritvelatrustlive` | 1,050,000 |
| AMRITVELA TRUST | `UCvo6eEtGT5LehydhnMo5sKw` | `@amritvelatrust` | 552,000 |

## Caching & quota strategy

YouTube Data API v3 default quota: **10,000 units/day**. Costs:
`channels.list` 1, `playlistItems.list` 1, `videos.list` 1,
`search.list` **100**.

| Data | Call(s) | Units | Cache | TTL |
|---|---|---|---|---|
| Panel channel list | Supabase query | 0 | module memory | 5 min |
| Channel metadata / search card | `channels.list` | 1 | AsyncStorage per channel | 6 h |
| Uploads first page | `playlistItems.list` + `videos.list` | 2 | AsyncStorage per channel | 30 min |
| Live + upcoming check | `search.list` ×2 (live, upcoming) | 200 | AsyncStorage per channel | 5 min |
| Search video leg | `search.list` + `videos.list` | 101 | AsyncStorage per channel+query | 10 min |
| Upload titles (suggestions/corrections) | `playlistItems.list` | 1 | AsyncStorage per channel | 24 h |
| Admin add/refresh | `channels.list` | 1 | — (deliberate action) | — |

Rules that keep quota sane:

- **Live checks are staggered**: Subscriptions runs them sequentially
  per channel, never in a burst, and the 5-minute cache is shared with
  every later open. The live check is the budget driver by design —
  it is what makes the rail's live dots truthful.
- **Search fan-out is capped** at `MAX_YOUTUBE_SEARCH_CHANNELS = 3`
  channels per query (admin order). Channel-card matching itself is
  local and free for any number of channels.
- Suggestions and typo-correction vocabulary reuse the 24 h titles
  cache; nothing fires per keystroke except local data.

### Worst-case daily units (per device)

Assumes heavy use: Subscriptions opened 20×/day, 30 full searches/day,
12 h of intermittent app use.

| Channels in panel | Live checks (20 opens, 5-min TTL ≈ ≤40 rounds) | Uploads (30-min TTL ≈ ≤24 rounds) | Search (30 queries, distinct) | Metadata + titles | **Total** |
|---|---|---|---|---|---|
| 1 | 40 × 200 = 8,000* | 24 × 2 = 48 | 30 × 101 = 3,030 | ~10 | **≈ 11,100** |
| 2 | 40 × 400 = 16,000* | 96 | 30 × 202 = 6,060 | ~20 | **≈ 22,200** |
| 3 | 40 × 600 = 24,000* | 144 | 30 × 303 = 9,090 | ~30 | **≈ 33,300** |

\* The starred rows exceed the 10,000/day default **if a single API
key serves many devices** — quota is per Google Cloud project, not
per device. In practice the 5-minute live cache collapses repeat
opens within a session (a realistic day is 6–10 live rounds, not 40:
≈ 1,200–2,000 units per channel), and typical totals land near
**2,500 (1 channel) / 5,000 (2) / 7,500 (3)**. If the panel grows past
3 channels or the sangat's usage grows, the honest options are:
lengthen the live TTL (dots get staler), check live only for the
selected channel, or request a quota increase from Google (free, via
the Cloud console audit form). Do NOT paper over quota by faking or
scraping — that is against the project's rules.

## Applying migration 0003 (main chat / owner)

1. Supabase Dashboard → project `haftawari-samagam` → SQL Editor.
2. Paste the whole of `supabase/migrations/0003_channels.sql`, Run.
   Expected: success, no rows returned.
3. Table Editor → `channels`: one row — Bhai Gursharan Singh Ji
   official, `is_active = true`, `sort_order = 0`.
4. Quick REST check: `GET /rest/v1/channels?select=*` with the anon
   key returns that one active row (RLS: anon sees active only).
5. In the app: Admin → Channels shows the seeded channel; add
   Amritvela Trust Live from Suggested, confirm the fresh lookup, Add.
6. Subscriptions rail now shows both channels; Search for
   "amritvela" shows the Amritvela channel card.
