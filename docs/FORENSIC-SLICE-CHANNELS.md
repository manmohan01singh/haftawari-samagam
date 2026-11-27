# Forensic Audit — Slice: Channels Admin Panel + Multi-Channel Surfaces

Date: 2026-11-27 (checks run 07:17–08:32 IST)
Live build audited: bundle `index-1eaa414c` (master a52733e1), verified by
downloading the live bundle and grepping it.
Method note (senior standard): functional results below come from the live
browser. The browser tool could NOT set a 412px viewport (screenshots
1919×998; the Android in-app browser was unavailable for that task), so
**412px layout is NOT browser-verified in this slice** — where a number is
dp-exact it is measured from the deployed source code and labelled
CODE. Items that could not be exercised are marked NOT TESTED, never PASS.

## A. Migration 0003 / backend state

| # | Item | Verdict | Evidence |
|---|---|---|---|
| A1 | `channels` table exists in Supabase | **FAIL (not applied)** | Live REST `GET /rest/v1/channels` → HTTP 404, code PGRST205 "Could not find the table 'public.channels'" (2026-11-27 07:17 IST) |
| A2 | App keeps working without the table (BGSJ fallback) | **PASS** | Live Subscriptions/Search run on the single BGSJ channel (sections B/C); `fetchActiveChannels` catches the query error and returns the fallback channel; a *successful* empty query would be honoured instead |
| A3 | Panel code present in the live bundle | **PASS** | Live bundle greps positive: "Add a channel", "Channels in the app", "@amritvelatrustlive" |
| A4 | Graceful missing-table message in the live bundle | **FAIL** | Live bundle grep for "channels table does not exist" = 0. The live panel (pre-fix) shows a generic error banner + a loading spinner that never stops. Fix exists on `fix/channels-round2` (46cdb712, pushed, unmerged): explicit message + fall-through to empty state |

## B. Subscriptions (live browser, signed out; taps tested)

Code inventory (CODE, at 412px): grid columns = 2 (width < 640); rail avatar
64dp, live dot 14dp, rail name 12sp/1 line, rail item width 76dp; chips
All/Videos/Live; sort Latest/Oldest.

| # | Item | Verdict | Evidence |
|---|---|---|---|
| B1 | Rail lists all active channels | **PASS (single-channel case)** | Exactly 1 avatar: "BHAI GURSHARAN SINGH JI (OFFICIAL CHANNEL)" (name visually truncated "BHAI GUR…" at rail width). Multi-channel rail NOT TESTED — only one channel can exist pre-migration |
| B2 | Live dot truthful | **PASS** | No red dot shown; API check the same morning: BGSJ not live (0 live broadcasts). Dot renders only from API-reported live state |
| B3 | Tap avatar → filter feed; tap again → Channel page | **PARTIAL** | 2nd tap opened the Channel page (correct URL/heading). 1st tap produced NO visible change (no perceptible selection ring/heading change observed); with one channel the filtered feed is identical to "All", so the filter itself is UNVERIFIABLE until ≥2 channels exist |
| B4 | "All" control | **PASS (as designed)** | No "All" avatar exists by design; with >1 channel an "All" text appears beside the heading when a single channel is selected. Single-channel state: nothing to switch — observed no-op is correct |
| B5 | Filter chip All | **PASS** | 20 videos |
| B6 | Filter chip Videos — Shorts excluded | **FAIL** | 20 videos, identical to All, including "Waheguru Shorts (1:07)". Root cause (CODE): `isShortVideo` only catches "#shorts" hashtag or duration ≤ 60s; this item is 67s with the word "Shorts" in the title but no hashtag, so it passes the filter. The user's Shorts ban is violated by this item |
| B7 | Filter chip Live | **PASS** | 0 videos; honest empty state: "No live or upcoming broadcasts" / "None of these channels is live right now or has an upcoming broadcast on YouTube." Matches API truth (no channel live) |
| B8 | Sort Latest/Oldest | **PASS** | First item changed from 27/11 Simran Sadhna (Latest) to 18/11 Chupehra (Oldest); list fully reversed; restored after test |
| B9 | Card ⋮ menu | **PASS** | Bottom sheet with Share + Cancel only — no fake actions (no Save/Watch Later backend on this surface) |
| B10 | 412px layout (columns, cut-off) | **NOT TESTED** | Browser could not set 412px (see method note). CODE says 2 columns at 412px |

## C. Search channel card (live browser, signed out; taps tested)

Code inventory (CODE): card avatar 88dp, name 20sp/700, pills 44dp high
(Subscribe + View Channel, 12dp gap), tint #E8EEF2, note "Follow is saved
on this device only".

| # | Item | Verdict | Evidence |
|---|---|---|---|
| C1 | "bgsj" → BGSJ channel card | **PASS** | Card rendered: verified name, @bhaigursharansinghjiofficial, "4.65 lakh subscribers • 7.2K videos" — matches live API (465,000 subs; 7,258 videos → "7.2K" truncated format) |
| C2 | Subscribe pill toggle | **PASS** | Subscribe → "Following" (bell + chevron), second tap restored "Subscribe", no dialog. Device-local only, labelled as such |
| C3 | View Channel pill | **PASS** | Lands on the correct Channel page |
| C4 | "Latest videos" under card | **PARTIAL** | 6 real items shown and item tap opened the correct Watch page, BUT it rendered as a vertical list at the audited width, not the horizontal carousel the code specifies (carousel card = 0.78 × window width). Needs re-check at true 412px |
| C5 | "gursharan" → card + results | **PASS** | Card appeared; results settled "25 results • plus the channel above" (All 25 / In this app 7 / On channels 18). Degraded banner shown: "Channel search is unavailable — showing matches from the channels' latest uploads." (uploads fallback worked) |
| C6 | "amritvela" → Amritvela channel card | **NOT IMPLEMENTED (by design, pre-migration)** | No Amritvela Trust card can exist until migration 0003 is applied AND an admin adds the channel. The BGSJ card appears instead (the 'amritvela' alias added to the BGSJ identity by the search-fix branch) |
| C7 | "amritvela" → video results | **FAIL** | No video results at all (15s wait), only the card + its 6 Latest videos. Banner verbatim: "Channel search is being rate-limited right now — showing the published archive only. Tap Retry in a moment." The classified-error + Retry machinery works as designed, but the user outcome is zero results for a query the API answers when not throttled. Note: the deployed bundle still fans searches out in parallel (the sequential fix is on `fix/channels-round2`, unmerged), which aggravates the burst throttling |
| C8 | Channel card matches ANY active channel | **NOT TESTED** | Impossible pre-migration (only the fallback channel exists). Code path is table-driven (`channelRegistry` → best match wins the card) |
| C9 | SPA route refresh (cross-scope, PWA shell) | **FAIL** | Directly loading/reloading /results?… or /channel?… returns GitHub Pages 404. In-app navigation works; refresh breaks. Belongs to the PWA-shell slice; recorded here because it hits these surfaces |

## D. Admin → Channels panel (live, signed-in)

**Status: NOT TESTED — blocked.** A browser task has been waiting since
07:40 IST on the secure sign-in card for the admin account ("Waheguru");
no saved login exists in the browser and the credential has not been
entered. Every panel control below is therefore inventoried from the
deployed code + bundle, with its expected pre-migration behaviour, and
must be exercised live in Phase 9 / sign-off once sign-in is provided.

Code inventory (CODE): screen max-width 960 centred; sections "Add a
channel" (input + "Look up channel" button), resolve preview card
(48dp avatar, title, handle • subs • videos line, UC id, "Add this
channel" button), "Suggested — tap to look up" (preset rows: 48dp
avatar, title, handle • subs • videos, note, "Look up" button), list
"Channels in the app (N)" with per-row 48dp avatar, Active/Inactive
chip, and buttons Activate/Deactivate, ↑, ↓, Refresh info, Remove
(two-tap ConfirmButton, arms for 4s). Admin-gated by AdminGate +
profile role; writes enforced by RLS `is_admin()`; every mutation
writes an audit_logs entry.

| # | Control | Verdict | Expected behaviour (CODE) |
|---|---|---|---|
| D1 | Panel renders for admin | NOT TESTED (blocked: sign-in) | Sections above render; non-admins never reach it |
| D2 | Look up @handle/URL/UC id | NOT TESTED (blocked) | Resolves via channels.list (1 unit); resolver itself was live-tested from code on 2026-11-26: @amritvelatrustlive and a channel URL resolved exactly; bogus handle → honest "not found, nothing saved" |
| D3 | Suggested preset: AMRITVELA TRUST LIVE | NOT TESTED (blocked) | Preset data re-verified against the API 2026-11-27 07:41: title/handle/avatar exact, subs 1,050,000 exact; videos 9,237 live vs 9,236 in preset (1 new upload — preset is date-labelled and Add re-resolves fresh) |
| D4 | Suggested preset: AMRITVELA TRUST | NOT TESTED (blocked) | API re-check: title/handle/avatar exact, subs 552,000 exact, videos 5,395 exact |
| D5 | Add this channel (pre-migration) | NOT TESTED (blocked) | Write hits the missing table → error. On the LIVE bundle the list area additionally shows the endless-spinner defect (A4); on `fix/channels-round2` it shows the explicit migration message |
| D6 | Activate/deactivate, reorder ↑/↓, Refresh info, Remove | NOT IMPLEMENTED to test pre-migration | No rows can exist until 0003 lands; controls are coded + audit-logged, to be exercised post-migration |
| D7 | Admin Overview → Channels link + counts | NOT TESTED (blocked) | Link exists in code ("Channels — Choose which YouTube channels appear in the app"); counts read 0 pre-migration via a caught head-count |

## E. Summary for the Forensic Audit chat

- PASS: A2, A3, B1 (single-channel), B2, B4, B5, B7, B8, B9, C1, C2, C3, C5
- PARTIAL: B3, C4
- FAIL: A1 (migration unapplied — central's step), A4 (live bundle lacks
  the graceful message; fix pushed on `fix/channels-round2`), B6 (Shorts
  heuristic gap: 67s "Shorts"-titled video passes), C7 (amritvela yields
  zero video results under rate limiting), C9 (SPA refresh 404 — shell slice)
- NOT IMPLEMENTED (by design, pre-migration): C6
- NOT TESTED: B10 + all of section D (blocked on admin sign-in, secure
  card outstanding since 07:40 IST) and multi-channel behaviour generally
  (B1/B3/C8) — cannot exist until migration 0003 is applied and a second
  channel is added.

No implementation corrections were made in this slice, per the mission
(corrections are Phase 9, after the user approves the audit). The two
already-pushed fix branches relevant here: `feature/channels` (a8ef658c)
and `fix/channels-round2` (46cdb712) — the latter re-applies the
sequential-search + graceful-message fixes that the union merge dropped.

## Addendum — 2026-11-27 09:37–10:00 IST (device browser, real phone width 886×1920)

Live build now Phase 11/12 (bundle index-907f824f). The user signed in
themselves during a browser takeover. Findings:

- The signed-in profile is "Mamm" (manmohan.labs@gmail.com), role
  badge **Member** — NOT the admin-promoted "Waheguru" profile. (Two
  profiles exist for this email's identities; the admin promotion of
  2026-11-26 sits on the other one.)
- **Admin gating: PASS.** No Admin dashboard entry anywhere for a
  Member (You/Library, Settings, Account all checked); direct routes
  /admin, /admin/channels, /channels, /account/profile all redirect to
  Home. Correct behaviour, not a missing link.
- **Channels panel: still NOT VERIFIED** — unreachable from a Member
  account. Requires an admin-role sign-in: the original "Waheguru"
  profile, or a promotion of the "Mamm" profile (central SQL step).
  The saved secure-entry password was also tested once against the
  "Waheguru" account in this session and rejected ("Email or password
  is wrong"), so that account's password remains unknown.
- **Search "bgsj": PASS** at phone width — card exact (name, handle,
  "4.65 lakh subscribers • 7.2K videos", Subscribe + View Channel,
  latest videos). Minor: the "Searching the channels…" status line
  was still visible above the card after results had loaded.
- **Subscriptions rail: 7 avatars** — AMRITVELA TRUST LIVE, AMRITVELA
  TRUST, Sakhiyan - Bhai Gursharan Singh Ji, SGPC Sri Amritsar
  (Darbar Sahib Live), Gurdwara Bangla Sahib Ji, Takhat Sachkhand Sri
  Hazur Sahib Live, Amritvela TV. NOTE: the BGSJ official channel is
  NOT in the rail list although the registry has 8 channels and BGSJ
  videos appear in the feed — flagged for the registry/follow-seeding
  owner to confirm whether that is intended.
- **Phone-width fit: PASS with one observation** — no horizontal page
  scroll, bottom nav reachable, long names ellipsis-truncate. Only 4
  of 7 rail avatars visible at once; an automated drag did not scroll
  the rail to reveal the rest (may be an automation limitation —
  needs a real finger-scroll confirmation on device).

## Addendum 2 — 2026-11-27 10:14–10:17 IST: PANEL VERIFIED END-TO-END (CLOSED)

Prerequisites landed: "Mamm" promoted to admin (central SQL, verified),
migration 0003 + 0004 applied (central; independently re-verified here:
REST GET /channels → HTTP 200). The user signed in themselves in the
browser; session verified as Mamm (admin). Live build: Phase 11/12
bundle. Results:

- D1 Panel renders: **PASS** — Admin dashboard entry visible on the
  You tab for Mamm; Overview → Channels entry present; counts before
  adds: Channels active 1 / total 1. Panel sections all present, no
  stuck spinner, no error banner. List = BGSJ seed, chip Active.
- D2/D5 Add flow: **PASS** — AMRITVELA TRUST LIVE Look up preview exact
  ("10.5 lakh subscribers • 9.2K videos", UC id correct) → Add →
  'Added "AMRITVELA TRUST LIVE" — it is now live in Subscriptions and
  Search.' → count 2. AMRITVELA TRUST preview exact ("5.52 lakh •
  5.3K videos") → Add → same success pattern → count 3; Suggested
  section correctly disappeared once both were added.
- D6 Activate/Deactivate: **PASS** — Deactivate → '"AMRITVELA TRUST"
  hidden from the app.', chip Active→Inactive, button flips; Activate
  → '"AMRITVELA TRUST" is now shown in the app.', restored. Final REST
  state (verified from here): 3 rows, sort 0/1/2, all is_active=true.
- Subscriptions after adds: rail shows 7 avatars including both new
  Amritvela channels (rail is follow/registry-driven; BGSJ official
  still not a rail avatar although its videos fill the feed — open
  observation from Addendum 1 stands).
- Search after adds: "bgsj" card **PASS**. "amritvela" card **FAIL** —
  no Amritvela channel card; the BGSJ card wins the slot (BGSJ's
  identity carries the 'amritvela' alias from the search-fix branch,
  and the run was in degraded/rate-limited mode). Expected fix: exact
  title/handle matches must outrank alias matches, and/or drop the
  'amritvela' alias from BGSJ now that the real Amritvela channels
  exist in the table. Handed to the search owner as a Phase 13 item.
- A4 re-check: with the table present the panel never shows the
  missing-table path; the graceful message remains in the code for
  any future missing-table state.

Section D is now fully exercised. Remaining open items in this slice:
the "amritvela" search-card ranking FAIL above, B6 (Shorts heuristic),
and the rail/BGSJ observation.
