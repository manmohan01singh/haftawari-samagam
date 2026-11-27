# FORENSIC_UI_AUDIT.md — YouTube vs Haftawari Samagam: Deep UI/UX Forensic Inspection

**Mission date:** 27 Nov 2026 · **Auditor:** central (this chat) · **Status: COMPLETE — awaiting user approval before any Phase 9 implementation**
**Rule of this report:** PASS / FAIL / NOT IMPLEMENTED / NOT INSPECTED only. No similarity scores. Every claim is tied to a measurement, a screenshot, or a `file:line` in the repo. Nothing here was "fixed" during the audit — inspection only.

---

## 1. Device / reference details & instruments (with honest limits)

| Instrument | What it actually is | Limit |
|---|---|---|
| User's device screenshots of the REAL native YouTube Android app | `docs/reference/` rounds 1–3: `01–07` series + `round2/` (ref-1…5, cur-1…4) + `round3/` (ref-search, ref-watch, app-watch ×2, app-search-fail); catalogue `REFERENCE_UI.md`. 1080px-wide captures, Premium, signed in. **Screenshot geometry wins over any catalogue text.** | Static frames; no timing/motion data; signed-in Premium state only. |
| m.youtube.com in a mobile browser at ~412px | **NOT ACHIEVED.** The cloud browser has no mobile emulation and no DOM/JS measurement. m.youtube.com redirected to `www.youtube.com/?app=desktop`; viewport was 1919×998. Desktop-layout numbers were captured (screenshots i1–i35) and are used ONLY where labelled "desktop proxy". | All 412px mobile-web values in §10 that rest on this pass are marked NOT VERIFIED — DEVICE/412 RE-CHECK REQUIRED. |
| Our LIVE PWA | https://manmohan01singh.github.io/haftawari-samagam/ — bundle `index-1eaa414cbe0e3376f0ea4b840fefaec4.js`, **verified live == local `dist/` hash** at audit start (27 Nov, ~08:27 IST). Also measured in the same 1919px cloud browser (ratios usable, absolute px not transferable to 412px). | Cloud network ≠ device network (a ~15s home load was observed in-cloud; not claimed as device truth). |
| Repo | `~/workspace/haftawari-samagam`, master `a52733e1` at audit start, clean tree. Full code forensics on layout components, all screens, navigation, theme tokens. | Code tells geometry/intent, not rendered pixels; rendered claims come from screenshots/live pass only. |
| Native app on a physical device | **Not available to the auditor.** True splash timing, hierarchy dumps, fullscreen/back-gesture behaviour on hardware: **NOT INSPECTED — DEVICE REQUIRED.** The user's OPPO is the final validation device. | — |

**Locked rules applied throughout:** NO SHORTS (P7.11 excluded by user decision — audited as NOT IMPLEMENTED — BY USER DECISION, not proposed); official YouTube embed only, controls/branding/ads never hidden; no background playback (Route 1, PiP substitute); truthful session labels UPCOMING / NOW PLAYING / COMPLETED; real counts/chat only; our own branding — pixel fidelity to YouTube's *patterns and geometry*, never its trademark assets.

---

## 2. Screen inventory (P5/P7 — verdicts)

Legend: **FULL** = implemented with real handlers/data · **PARTIAL** = renders but with a named gap · **MISSING** = no screen · **NOT IMPLEMENTED** = deliberately delegated/absent.

| # | Screen | Verdict | Evidence (short) |
|---|---|---|---|
| 1 | Splash | **FAIL — MISSING (native)** | No `expo-splash-screen`, no `splash` key in `app.json`; `assets/splash-icon.png` unreferenced. Web-only CSS splash exists in `public/index.html` (see §9). Native launch = uncontrolled OS/Expo default. |
| 2 | First launch | **MISSING** | No onboarding/first-run flow, no seen-flag anywhere. Signed-out users land on Home. |
| 3 | Home | **FULL** (geometry FAILs in §10) | `HomeScreen.tsx` (600L): header, SecondaryTabs, ChipsRow, live banner, paginated feed (PAGE_SIZE 25, `onEndReached`), PTR via FlatList props, skeletons, real card actions. |
| 4 | Search | **FULL** | `SearchScreen.tsx` (420L): pill field, autofocus, 300ms-debounced suggestions, real recents with Undo, Clear-all confirm. No loading indicator (local sources). |
| 5 | Search results | **FULL** | `SearchResultsScreen.tsx` (725L): channel block, filter chips, classified errors + retry, skeletons. No pagination (single result set). |
| 6 | Video details (Watch) | **FULL, 1 PARTIAL** | `WatchScreen.tsx` (1005L). Like/Dislike = honest toast ("not available… nothing was recorded") — real feedback, no fake state: PARTIAL by design. No YouTube comments section — replaced by session chat (#24). |
| 7 | Video player | **FULL (delegated)** | Official embed only, §5/§7. |
| 8 | Fullscreen player | **NOT IMPLEMENTED as app UI** | Zero app fullscreen code; entirely the embed's own fullscreen. Back-from-fullscreen NOT INSPECTED — DEVICE REQUIRED. |
| 9 | Channel | **FULL** | `ChannelScreen.tsx` (627L): banner, 88dp-class header skeleton, Videos/Live tabs, token pagination. One `()=>undefined` Pressable is a deliberate menu tap-absorber, not a dead control. |
| 10 | Playlist / Playlists | **FULL** | Real rows, Play-all, create sheet, PTR. |
| 11 | Shorts | **NOT IMPLEMENTED — BY USER DECISION** | No route, no shelf, no nav slot (slot 2 = Subscriptions). Not proposed. |
| 12 | Subscriptions | **FULL** | Avatar rail, chips, sort, merged uploads of device-local follows. No pagination. |
| 13 | History | **FULL** | Server + honestly-labelled on-device local history; clear flows confirmed via modal. |
| 14 | Library / You | **FULL** | Profile header, History shelf, shortcuts, playlists, admin entry (admins). Loading = spinner only (§9). |
| 15 | Profile / Account | **FULL** | Real account data, real sign-out. No loading UI beyond plain "Loading…" text. |
| 16 | Notifications | **MISSING — by design** | No screen/route/bell. Documented in `AppHeader.tsx:28-30`: no backend, omitted rather than faked. FAIL vs the mission's screen list; PASS vs the no-fake-controls rule. User decision needed only if he wants a backend built. |
| 17 | Settings | **PARTIAL** | `SettingsScreen.tsx` (345L) is a working navigation/account hub, **not a preferences screen**: no theme switch, no notification prefs — deliberately omitted as non-functional (L47-48). |
| 18 | Sidebar / drawer | **FAIL — MISSING in the running app** | `Sidebar.tsx` exists but is imported **nowhere**; rows are plain `View`+`Text`, no icons, no Pressable, no navigation; collapsed mode renders first letters, contradicting its own doc comment. No drawer on mobile or wide PWA. |
| 19 | Dialogs | **FULL** | `ConfirmModal` (fade Modal), admin two-tap `ConfirmButton`; zero `Alert.alert` anywhere. |
| 20 | Bottom sheets | **FULL (Modal-based)** | `CardActionSheet` + playlist sheets use RN `Modal animationType="slide"` (platform-default timing); `SessionChat` is the only true draggable sheet. |
| 21 | Admin dashboard | **FULL — 8 screens** | Overview/Videos/Channels/Sessions/Categories/Members/ChatModeration/AuditLogs, all real `adminService` calls, `AdminGate` + RLS. Members is read-only **by design** (promotion is a documented dashboard SQL act). Spinner-only loading; no PTR/pagination. Note: `AdminChannels` has **no deep-link URL** (missing from `linking.ts`). |
| 22 | Samagam archive (Sessions list) | **FULL** | SectionList grouped NOW PLAYING / UPCOMING / COMPLETED — labels truthful. |
| 23 | Active Samagam (SessionWatch) | **FULL** | Synced embed (server-clock position, drift re-seek, Sync button), real Realtime presence count, Join/Leave real. |
| 24 | Sangat chat (SessionChat) | **FULL (embedded sheet, not a route)** | Real gating (sign-in → join → post), real participant count, history paging, send-error keeps draft. |

Extra screens outside the mission list, all FULL: Saved, SignIn, SignUp, SetNewPassword (recovery gate, no back by design).

**Stub verdict:** zero screens route to `StubScreen` (defined, never imported). Two dead artefacts remain in the tree: `StubScreen.tsx` + its `Header.tsx`, and `Sidebar.tsx`.

---

## 3. Screenshot inventory

Reference (YouTube native app, user's device): `01-mobile-home-feed`, `02-mobile-subscriptions`, `03-mobile-search-channel-result`, `04-mobile-you-library`, `05-mobile-live-chat-opening`, `06-mobile-live-watch`, `07-mobile-live-chat-messages`; round2 `ref-1-home, ref-2-subs, ref-3-search, ref-4-you, ref-5-livechat`; round3 `ref-search-bgsj, ref-watch-live`.
Ours (device captures of earlier builds, same rounds): round2 `cur-1-home, cur-2-library, cur-3-channel, cur-4-subs`; round3 `app-watch-live1, app-watch-live2, app-search-amritvela-fail`.
Live pass (this audit): cloud-browser screenshots i1–i35 at 1919×998 (desktop proxy only — see §1).
**Gap:** no device captures of the CURRENT build (`a52733e1`) exist for Watch/Search/Subscriptions — round2/3 "cur/app" frames predate later merges. Current-build device captures are a Phase 9 entry requirement (§13).

---

## 4. Layout measurements (P1 — reference vs ours)

Reference values are from `REFERENCE_UI.md` as corrected by direct screenshot study (screenshot wins). Ours are code values (`file:line` in §7/§8) confirmed against device captures where noted.

### A. Launch sequence — **FAIL / NOT INSPECTED (device)**
Reference: native YouTube launch (icon → splash → feed) cannot be timed from static screenshots — NOT INSPECTED.
Ours: no splash system at all (§2.1). Code launch chain: `index.ts` → `App.tsx` renders providers + `RootNavigator` immediately; **no readiness gate** — `RootNavigator` reads `AuthContext.loading` only to suppress the password-recovery stack. First paint = Home with its own skeletons. Web PWA has a hand-built pre-JS splash shell (`public/index.html`): 56px bar, 30×21 red mark, "Loading samagams…", CSS spinner `0.9s linear infinite`, 2 static skeleton cards; replaced on React mount with **no fade-out**.
Verdict: splash duration/logo/transition — NOT DEFINED in the product. FAIL against P1.A.

### B. Header — **PARTIAL**
| Measure | Reference (native) | Ours (code + captures) | Verdict |
|---|---|---|---|
| Height | ≈56px | 56 (token `layout.headerHeight`) | PASS |
| Side padding | ≈16px | 16 (`spacing.lg`) | PASS |
| Left | Red play mark + wordmark | 30×21 **red rounded rect with white play-arrow** + "Haftawari" 20/700 | **FAIL — trademark risk**: the mark reproduces YouTube's play-button logo shape/colour. Locked rule: own branding only. Must be replaced with an original mark in Phase 9. |
| Right icons | Cast, bell with red 9+ badge, search (≈24px, gap ≈20–24) | Search 24px + account avatar 28×28 only; gap 22 hardcoded | PARTIAL — cast/bell absent by documented design (no backend); spacing matches |
| Safe area | System bar above | `AppHeader` has **no inset handling** — caller must offset | PARTIAL — verify per-screen on device |
| Material | Flat white | BlurView (intensity 72, tint light) + `rgba(255,255,255,0.82)` fallback — **light-only** | FAIL (dark) — see dark-mode flag §7 |
| Scroll behaviour | Sticky | Sticky (live pass: header + chips stayed) | PASS (desktop proxy) |

### C. Back navigation — **PARTIAL (HIGH PRIORITY item)**
Reference pattern: back arrow at the left edge of a dedicated header row, ≈24px glyph, consistent position on search (left of pill field) and stacked screens; system back respected.
Ours (code): one consistent helper — `safeBack.ts goBackOrTab()`: `canGoBack() ? goBack() : navigate(MainTabs, fallback)` (fallback Library for library/auth/account, Home otherwise). Screens render their own `arrow-back:24` in their own headers (Watch, Search, SearchResults, Channel, Playlist, History, Sessions, SessionWatch…), so **position is per-screen hand-placed, not one shared component** — the consistency risk the mission flagged is real even though captures show it landing top-left in Search/Channel (live pass: both worked, ≈20px glyph in ≈40px area).
Exceptions/inconsistencies:
- **Admin stack** uses native-stack headers + native back — a different visual system from every other screen.
- **Watch (PWA, desktop-width live pass):** back control sits *below* the player in the sheet and was **covered/unclickable** at 1919px (iframe trapping); browser Back was the only exit. At 412px the round3 device capture shows a back arrow **overlaid on the player top-left inside a dark circle** — a third placement pattern. → Back placement on Watch is **inconsistent across surfaces: FAIL**, device re-check required.
- SetNewPassword has no back (by design, recovery gate). Tab roots have no back (correct).
- Android predictive back is disabled in `app.json` (`predictiveBackGestureEnabled:false`); gesture behaviour on device NOT INSPECTED.

### D. Homepage — **FAIL on card geometry details** (structure PASS)
| Measure | Reference | Ours | Verdict |
|---|---|---|---|
| First content | Feed card directly under tab row | "Samagam Sessions" banner card + an "All" ChipsRow are inserted before/inside the feed (device capture cur-1) | FAIL — extra vertical stack pushes first samagam down; not in reference geometry |
| Secondary tabs | 5 text items: Home/Subs/Music/Live/More, selected = pale pill | 3 items: Home/Subs/Live (`SecondaryTabs.tsx`) | FAIL — Music/More missing (content decision may be user's, but geometry differs; flagged, not assumed) |
| Thumbnail | Full-bleed 16:9 on Home | Full-bleed, `aspectRatio 16/9` token, **top radius 16 / body bottom radius 20 + card shadow** (FeedCard) — reference cards are flat, radius 0, separated by whitespace | FAIL — ours is a floating card; reference is edge-to-edge flat |
| Title | Full-width above avatar row, 16–17px/600, 2 lines | 16/22/600 hardcoded, full-width, 2 lines | PASS |
| Avatar row | Avatar 40 + handle line + watching/views line | Avatar 40×40, handle **and meta both 14px hardcoded** (meta token is 12; reference meta ≈13–14) | PARTIAL |
| Engagement row | Like, comment, bookmark, ••• (horizontal), 24px, gap ≈20, no counts | **Bookmark, Share, More (more-horiz)** only — like/comment deliberately omitted (no backend); share icon is 22px, its target ≈42px | FAIL vs reference geometry; omission itself is documented/honest |
| Card separation | Whitespace ≈16–24px | `marginBottom 12` + shadow | FAIL |
| Skeletons | (native) shimmer cards | Geometry-matched but **static** (§9) | PARTIAL |
| Pull-to-refresh / infinite scroll | Yes / yes | Yes / yes (PAGE_SIZE 25) | PASS |

### E. Drawer / sidebar — **FAIL** (see §2.18: component dead, no drawer anywhere, no open/close animation, no overlay). Reference sidebar behaviour is desktop/mobile-web territory; on the native app there is no drawer either — but the mission requires auditing ours, and ours ships a misleading dead component. Desktop-width PWA also has **no sidebar** (live pass: content centred, max-width ≈960, grey gutters) where desktop YouTube has the 72/240 sidebar.

### F. Search — **PARTIAL**
Reference: back arrow left; grey pill field with × clear inside; mic in light circle; cast; vertical ⋮. Results lead with the channel block (avatar 88, name 20 bold, Subscribed pill + View Channel pill ≈48% each ≈44 tall), "Latest videos", inset cards radius 12.
Ours: back arrow + pill field + × clear (PASS geometry); **no mic, no cast, no ⋮** (mic/cast absent by no-backend design). Suggestions: real recents + catalogue, rows ≈48px (live pass), fill-arrow present. Results channel block exists with bell pill + View Channel (PASS pattern). Search screen loading = text hint only (FAIL §9). Keyboard appearance/resize: NOT INSPECTED — DEVICE REQUIRED.

### G. Watch — **PARTIAL**
Reference: player pinned top 16:9; white sheet **radius ≈20 overlapping the player's bottom edge**; title 1 line ≈20px; metadata line ≈14px; action row = avatar + Subscribed bell pill left, like/dislike/share/sparkle/••• right (icon-only); Live chat card (grey, radius 16) below; Up Next = full cards, **no "Up Next" heading**.
Ours (code): the sheet exists in code — Watch skeleton keeps `borderTopRadius:20, marginTop:-20`, player facade = real thumbnail + spinner. But the round3 device capture of the running app shows: **no visible sheet overlap**, description box expanded by default, "View Channel ›" pill instead of the Subscribed bell pill in the action row, actions reduced to like/dislike/share, an **"Up Next" heading** with compact list rows instead of full cards, and a **duplicated "12 watching"** in the metadata line ("12 watching · 194 likes · 12 w…"). → The code has moved since that capture (bell pill + sheet are in current source); which parts are fixed in `a52733e1` is **NOT VERIFIED on device**. Verdict: PARTIAL — device re-capture of current build is mandatory before Phase 9 scoping is final.
Player itself: §5/§7 — official embed, PASS on compliance.

### H. Bottom nav — **PARTIAL**
| Measure | Reference (native) | Ours | Verdict |
|---|---|---|---|
| Slots | 4, icon-only, no labels | 4, icon-only, labels a11y-only | PASS (slot 2 = Subscriptions per user decision) |
| Height | ≈56–64 + gesture inset | 56 token + `insets.bottom`, safe-area correct | PASS |
| Icons | 24px; active = filled glyph | 24px; active = **colour change only** (same glyph; caller passes `'home'` for both states) | FAIL — no filled/outline state switch |
| Centre slot | Circled + (28px circle) | Circle 28×28, border 1.5, glyph `add` 20 — opens official Channel (documented QA43 deviation) | PARTIAL — geometry PASS, semantics differ by design |
| Profile slot | User's avatar photo | Real avatar URL/initial, 28×28; active = 2px ring | PASS |
| Selected pill | **None** in reference | Round2 device capture shows **pale pill backgrounds** behind selected icons; code today has no pill (stale comment in BottomNav claims one) | NOT VERIFIED on current build — re-capture required |
| Background | White, hairline top border | Blur material (light-only) + hairline border; live pass sampled off-white #F5F0EE, no visible border line at desktop width | PARTIAL |
| Hide on scroll | No (native) | No hide-on-scroll logic | PASS |
| Press feedback | Ripple | **None** | FAIL (§6) |


---

## 5. Animation specifications (P2) — **FAIL by absence**

There is effectively **no animation system**. `react-native-reanimated` is not installed; `react-native-gesture-handler` is imported once (`App.tsx:1`) and never used for animation. Complete inventory of everything that moves:

| # | Where | Spec (exact, from code) |
|---|---|---|
| 1 | `SwipeableRow.tsx` (library rows) | The app's only `Animated` use: spring on `translateX`, `bounciness:0, speed:20`, snap at 40dp, action width 88dp |
| 2 | `SessionChat.tsx` sheet drag | `PanResponder` + **useState** (re-render per move, not Animated); height clamped [240, 0.98×screen]; snap threshold 90dp; heights 0.72 → 0.92 of screen; release = **instant state snap — no spring, no easing** |
| 3 | All sheets/modals | RN `Modal animationType="slide"` (CardActionSheet, playlist sheets, chat) / `"fade"` (ConfirmModal, Channel menu) — platform-default timing; **no duration/easing exists in code to audit** |
| 4 | Thumbnails | `expo-image transition` crossfade: 200ms (Feed/Shelf), 150ms (Feed avatar-side/Grid); all other images instant |
| 5 | Web splash spinner | CSS `0.9s linear infinite` rotation — the only loop animation in the product |
| 6 | Press feedback | Exists in **3 places only** (SessionCard opacity 0.85; SessionWatch 0.8; Home sessions row). BottomNav, AppHeader, all cards: **no pressed style, no ripple, no scale** |
| 7 | Watch mount | Player deferred 60ms via `setTimeout` "after navigation transition settles" (not an animation) |
| 8 | Toast | Instant mount/unmount, 2600ms auto-dismiss, no fade/slide |

**Navigators:** RootNavigator, MainTabs, AdminStack set **no** `animation`/`animationDuration`/`gestureEnabled`/`presentation` options — every screen transition is the react-native-screens platform default, unmeasured and unspecified. Tab switch = instant swap + icon colour change.
**NOT IMPLEMENTED:** launch/splash exit, home appearance, sidebar (none), search open/close, bottom-nav selection animation, card interaction, player expansion, skeleton shimmer, pull-to-refresh beyond the native spinner. 60 FPS target: nothing to measure — DEVICE REQUIRED for the defaults that do run.

**Phase 9 animation spec (proposed, §11):** adopt Reanimated; stack push/pop 250–300ms ease-out/in platform-standard; sheet spring (damping ~26, stiffness ~260) replacing the state-drag; tab selection colour+fill crossfade 150ms; card press opacity 0.92 / ripple on Android; skeleton shimmer 1200ms sweep; splash fade-out 200ms once a real splash exists. All values to be confirmed against device captures, not assumed.

---

## 6. Icon inventory (P4) — **PASS with notes**

- **One family only:** `@expo/vector-icons` **MaterialIcons**, 34 files, 133 usages, **47 distinct glyphs**. No Ionicons/Feather/etc. mixing. Dominant size **24** (50 uses), then 22 (27), 20 (20), 18 (16) — sizes are per-call-site literals, **no size token**; outliers: Watch share is the app's only **23**, GridCard kebab 18, ShelfCard sensors 12 vs FeedCard 14.
- **Emoji as icons: NONE in live UI.** The only glyph-as-icon code is in the dead `Header.tsx` stub (text `☰` and `▶`) — delete with the stub. (The 🔴 seen in one device capture is inside a YouTube video *title string* — source metadata, not app UI.)
- **Custom SVG: exactly one** — the licensed Google "G" (`GoogleGIcon.tsx`, official 4-colour paths). No other SVG assets.
- **Brand mark problem (repeat of §4.B):** `AppHeader`'s mark is a 30×21 red rect + white `play-arrow` — a YouTube-logo lookalike built from a View + Material icon. FAIL under the own-branding rule regardless of icon-family cleanliness.
- Key glyphs: back `arrow-back:24` everywhere (consistent); search `search:24` header / `22` submit; overflow **inconsistent**: `more-horiz` (FeedCard 24, ShelfCard 20, Watch 24) vs `more-vert` (FeedCard-UpNext 20, GridCard 18, Channel rows) with no surface rule written down; subscribe `notifications/notifications-none:20` + `expand-more:18`; bottom nav `home`, `subscriptions`, centre `add:20` in a bordered circle, avatar slot.
- States: default/active = colour only; disabled states exist only in chat Send and admin buttons; **pressed state absent** (§5.6); tooltips: none (a11y labels present on nav).

## 7. Button inventory (P4/P8) — measured touch targets

System: `src/lib/touch.ts` — `ICON_HIT_SLOP=10` (24px icon → **44px** target: meets 44, fails 48), `SMALL_ICON_HIT_SLOP=12` (20px → 44px).

| Control | Target | Verdict |
|---|---|---|
| Header search | 44×44 | PASS 44 / FAIL 48 |
| Header avatar | 48×48 | PASS |
| BottomNav items | ≈103 wide × ≥44 high @412 | PASS |
| FeedCard bookmark / more | 44 | PASS 44 |
| FeedCard **share** | **≈42** (22px + slop 10) | **FAIL <44** |
| FeedCard-UpNext **kebab** | **≈36** (20px, hitSlop 8, no min size) | **FAIL <44** |
| GridCard **kebab** | **≈34** (18px, hitSlop 8) | **FAIL <44 — smallest in app** |
| ShelfCard kebab | ≈56 (32 min + slop 12) | PASS |
| Sidebar rows (dead component) | 40 high, not pressable | FAIL (moot — delete) |
| ChipsRow chips | ≈44 high with slop | PASS |
| SecondaryTabs items | ≈44 high with slop | PASS |

**Inert/misleading controls (P8):**
- `VideoCard.tsx`: `onPress` prop is declared but **never wired** — the component renders a plain `View`; the card can never be pressed. (Check where it's still used; FeedCard/ShelfCard/GridCard are the live cards.) **FAIL.**
- FeedCard fallback wiring: when Save/Share/More handlers are absent, all three **fall back to opening the video** — a misleading affordance (a ⋯ that plays the video). FAIL.
- Header.tsx stub: fully inert (no Pressable at all) — dead code, delete.
- Sidebar.tsx: fully inert — dead code, delete.
- Otherwise P8 is strong: global greps found **zero** `onPress={()=>{}}`, zero TODO/FIXME, zero `Alert.alert` placeholders; Watch Like/Dislike give an honest toast instead of fake state; cast/bell/mic omitted rather than faked.

## 8. Navigation behaviour (P1.C/P8)

- Architecture: native-stack root (16 routes, `headerShown:false`, custom in-screen headers) + 3-route bottom tabs (4th nav slot is a pseudo-key action → Channel) + separate native-header Admin stack. **Not Expo Router** — the repo's `AGENTS.md` template text (Expo Router, `src/app/`) does not describe this codebase; noted so Phase 9 doesn't "fix" it by accident.
- Back: `goBackOrTab` everywhere except Admin (native) and SetNewPassword (none, by design). Deep-link/refresh entry on the PWA can't dead-end (fallback tab) — PASS, and live-pass Search/Channel backs worked.
- Chains (code-verified): Home → Watch → push Watch (Up Next stacks correctly); Search → Results → Watch; Channel → Watch; Library → History/Playlists/Saved → Playlist → Watch. No fake navigation found.
- Linking (web only; native has none): all main routes mapped; **`AdminChannels` missing** from linking config — that one admin screen has no URL. FAIL (minor).
- Fullscreen back, system gesture back, nested gesture conflicts: NOT INSPECTED — DEVICE REQUIRED.

## 9. Loading behaviour (P3) — **PARTIAL**

One skeleton component (`SkeletonCard`, variants feed/shelf/row) with geometry that faithfully mirrors the real cards (feed: thumb top-radius 16, body bottom-radius 20, padding 16/12, avatar 40; shelf/row likewise) — **but it is completely static: no shimmer, no pulse, no gradient.** Skeleton→content is a hard cut (only thumbnails fade, 150/200ms).

| Surface | First load | Verdict |
|---|---|---|
| Home | Skeleton ×2 feed + footer spinner; PTR yes | PARTIAL (no shimmer) |
| Subscriptions | Skeleton ×2 shelf | PARTIAL |
| Channel | Bespoke header skeleton (banner + 88 avatar + bars + pills) + shelf | PARTIAL — best in app |
| Search results | Spinner + "Searching for…" label + skeleton ×3 | PARTIAL |
| Watch / SessionWatch | Bespoke player block (real thumbnail on Watch) + sheet lines, sheet geometry preserved | PARTIAL |
| Sessions list | Spinner+label **above** skeletons (double indicator) | FAIL (minor) |
| History / Playlists / Playlist / Saved | Skeleton rows (Saved's signed-out branch is spinner-only) | PARTIAL |
| Library | **Spinner + text only, no skeleton** | FAIL |
| Chat | Centred spinner only; no reconnection placeholder | FAIL |
| Admin (all 8) | **Generic spinner + label everywhere** | FAIL |
| Search (suggestions) | Nothing (local/instant) | PASS-by-design |
| Settings | No loading UI at all | — |
| Startup (web) | CSS splash: spinner + 2 static skeleton cards | PARTIAL |
| Startup (native) | Nothing — screens skeleton individually | FAIL |

Failure fallback: skeletons carry no timeout; screens swap to `EmptyState`/error+retry — acceptable, but there is no skeleton-specific failure state. No layout jumps were found in code (skeleton geometry = card geometry); rendered jump check is DEVICE REQUIRED.

## 10. Visual discrepancy report (P6) — correction task per mismatch

Method note: true 412px side-by-side was **not achievable** with the available browser tooling (§1). Comparisons below rest on (a) device screenshots of both apps (rounds 1–3), (b) code measurements, (c) the 1919px live pass for ratios/behaviour only. Items resting only on (c) are marked ◌ NOT VERIFIED at 412px.

| # | Discrepancy | Evidence | Correction task (Phase 9) |
|---|---|---|---|
| D1 | Header brand mark = YouTube play-logo lookalike (red rect + white play triangle) | Code `AppHeader.tsx`; live pass; cur-1 capture | Design an original Haftawari mark; replace in AppHeader + web splash + icons |
| D2 | Bottom-nav active state: colour-only, same glyph; reference switches filled/outline | `BottomNav.tsx`, `MainTabs.tsx` (passes `'home'` for both states) | Filled vs outline glyph per state |
| D3 | Bottom-nav selected pill seen in round2 capture; code has no pill (stale comment claims one) | cur-1/cur-2 captures vs `BottomNav.tsx` | Re-capture current build on device; make code and capture agree; reference = NO pill |
| D4 | FeedCard is a floating shadowed card (radius 16/20, shadow, margin 12); reference is flat edge-to-edge, whitespace-separated | `FeedCard.tsx` styles; cur-1 capture | Flatten home variant: radius 0, no shadow, separation 16–24 |
| D5 | Feed engagement row = bookmark/share/more-horiz; reference = like/comment/bookmark/••• | `FeedCard.tsx` (like/comment omitted — no backend, documented) | Geometry decision for user: keep honest 3-icon row but align sizes/gaps (24/24/24, gap 20) and fix share target; do NOT fake like/comment |
| D6 | Feed meta/handle both 14px hardcoded; token metadata is 12; reference ≈13–14 | `FeedCard.tsx` | Tokenise: handle 14, meta 13–14 per reference, from tokens not literals |
| D7 | SecondaryTabs = 3 items vs reference 5; selected pill `#F8E9EC` hardcoded, no token; token says padding 16, code uses 12 | `SecondaryTabs.tsx` | Tokenise colour/padding; user's call on Music/More items |
| D8 | Home inserts Sessions banner + "All" ChipsRow above/inside feed; reference goes straight to cards | cur-1 capture; `HomeScreen.tsx` | Move Sessions entry below first cards or into its own row per reference spacing — user decision (it's our feature, geometry is the issue) |
| D9 | Watch: sheet overlap/title/action-row/Up-Next form unverified on current build; older capture FAILs on all four + duplicated "watching" count in metadata | round3 app-watch vs `WatchScreen.tsx` (sheet + bell pill exist in code now) | Device re-capture FIRST; then fix what remains (metadata de-duplication is a data-format bug regardless) |
| D10 | Watch back placement inconsistent (overlay-on-player in PWA capture vs in-sheet in code vs covered at desktop width ◌) | round3 capture; live pass | One rule: back in the sheet header row, same position as Search/Channel; never overlaying the embed |
| D11 | No sidebar/drawer anywhere; dead Sidebar component; desktop PWA centres content with grey gutters, no 72/240 rail | §2.18; live pass ◌ | Delete dead component; decide wide-layout rail for PWA (reference desktop has one) |
| D12 | Dark mode broken in the chrome layer: every audited component imports `lightColors` only; blur background is light-only milky white | Task-A forensics across layout/video components | Wire theme through AppHeader/BottomNav/cards/blur or explicitly scope dark out — currently `darkColors` tokens exist but are unused here |
| D13 | Badge radii inconsistent: duration badge radius 4 (VideoCard) / 6 (Feed/Shelf/Grid) / LIVE badge 8 in FeedCard while its token says 6 and the token is misapplied to duration | Card forensics | One badge token set: LIVE 6, duration 4–6 — pick per reference (LIVE ≈6) and apply uniformly |
| D14 | Shelf/Grid thumbnails placeholder on black `playerBackground`; FeedCard uses `surfaceVariant` | Card forensics | Uniform placeholder colour |
| D15 | Sub-44 touch targets: share ≈42, UpNext kebab ≈36, GridCard kebab ≈34 | §7 | hitSlop/min-size to ≥44 (48 preferred) |
| D16 | ChipsRow radius 8 hardcoded; chip height ≈32 matches reference ◌; PWA secondary row is sticky, desktop YouTube's scrolls away ◌ | `ChipsRow.tsx`; live pass | Tokenise radius; stickiness rule per surface, verify at 412 |
| D17 | Search: no mic/cast/⋮ in header row (reference has all three) | `SearchScreen.tsx` | Absent-by-design (no backend) — keep absent; geometry of what exists PASSes |
| D18 | Admin: native headers vs custom headers everywhere else; spinner-only loading; AdminChannels un-linkable | §2.21, §8 | Align admin chrome or document as deliberate; add linking entry |
| D19 | Home first load in cloud ≈15s behind one flat grey block ◌ (splash shell shows 2 skeleton cards in code — observed render differed) | Live pass; `public/index.html` | Reproduce on device/real network before treating as a defect |

## 11. Proposed implementation changes — IN THE MISSION'S PRIORITY ORDER (Phase 9, NOT started)

1. **Launch/splash:** add `expo-splash-screen` + `app.json` splash with the ORIGINAL mark (after D1), hold until auth+first data ready, 200ms fade-out; mirror in web splash.
2. **Header/nav:** original brand mark (D1); tokenise wordmark (20/700/−0.5 from a type token); keep 56/16 geometry; decide cast/bell permanently absent (documented) — no fake icons.
3. **Back placement:** one shared `StackHeader` component (back left, 24 glyph, 48 target, fixed offsets) used by every stack screen incl. Watch (D10) and Admin; delete per-screen hand placement.
4. **Home geometry:** flatten FeedCard home variant (D4), remove shadow, separation 16–24, reposition Sessions entry (D8, user call).
5. **Video cards:** tokenise all card type sizes (D6), unify badge radii + placeholder colour (D13/D14), fix sub-44 targets (D15), fix FeedCard fallback wiring and VideoCard's dead `onPress` (§7), align engagement row geometry (D5).
6. **Search:** keep geometry; add skeleton for results leg only; no fake mic/cast.
7. **Player:** no embed changes (compliance PASS); verify sheet overlap + metadata de-dup on device (D9) and fix in WatchScreen only.
8. **Bottom nav:** filled/outline active glyphs (D2), settle the pill question by device capture (D3), press feedback.
9. **Sidebar:** delete dead `Sidebar.tsx`/`Header.tsx`/`StubScreen.tsx`; wide-PWA rail decision (D11).
10. **Loading:** add shimmer to SkeletonCard (single shared sweep), Library + Chat + Admin skeletons, remove Sessions double indicator.
11. **Animation:** adopt Reanimated per §5 spec; chat-sheet spring; tab crossfade; card press states everywhere.
12. **Secondary screens:** dark-mode wiring or explicit scope-out (D12); Settings stays honest (no fake prefs); Admin linking fix (D18); Notifications stays absent unless user funds a backend.
**Explicitly NOT proposed:** Shorts (user decision), fake like/comment counts, hidden embed branding, background playback.

## 12. Before screenshots

Rounds 1–3 device captures listed in §3 are the before-state of record. After-shots are a Phase 9 deliverable, taken on the OPPO at the same screens/states.

## 13. Regression approach

- **PWA visual regression (Playwright-style):** fixed 412×915 viewport, signed-out + signed-in fixtures, screenshot diffs for Home/Search/Watch/Channel/Library/Subscriptions at each Phase 9 step; bundle-hash check after every deploy (the AGENTS.md gh-pages lessons apply: `.nojekyll`, worktree publish, live bundle grep for Supabase host).
- **Native validation:** OPPO device pass — splash timing, back gesture, fullscreen exit, keyboard resize on Search, PiP entry — the NOT INSPECTED list in §14 is the checklist.
- **Code gates:** `npx tsc --noEmit` + `npx expo lint` per repo convention; token-literal grep (no new hardcoded sizes/colours in layout components).
- **Interaction sweep:** re-run the P8 handler audit (grep + tap-through) after Phase 9; the zero-inert-controls result must not regress.

## 14. Remaining limitations

1. **NOT INSPECTED — DEVICE REQUIRED:** native splash timing/exit; true 412px rendered geometry of the current build (all ◌ items); fullscreen enter/exit + back-from-fullscreen; system back gesture; Search keyboard resize; bottom-nav pill question (D3); Watch sheet/metadata on current build (D9); PiP on the OPPO; 60 FPS of platform-default transitions; home load time on a real network (D19).
2. m.youtube.com at 412px was **not measurable** with available tooling (desktop redirect, no emulation) — mobile-web reference values rest on the user's native-app screenshots + the earlier mobile-web audit referenced by `REFERENCE_UI.md`, not on a fresh 412px pass.
3. Round2/3 "ours" captures predate merges up to `a52733e1`; where code and capture disagree, this report says so instead of picking a winner.
4. Admin screens were audited from code only (no admin session in the live pass).
5. This audit covers UI/UX geometry, motion, loading, icons, navigation and interaction wiring. It does not re-audit data correctness, RLS, or the session sync engine beyond their visible UI.

---

*End of report. Phase 9 begins only on the user's approval of this document.*
