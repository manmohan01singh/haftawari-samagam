# REFERENCE_UI.md — Native YouTube Android App: Exact UI/UX Reference

Catalogued 26 Nov 2026 from the user's own screenshots of the **native YouTube
Android app** (Premium, signed in), supplied by the user as the exact UI/UX
reference for Haftawari Samagam ("exact exact ui ux reference, same type fonts
same everything").

Files: `01-mobile-home-feed.jpg` … `07-mobile-live-chat-messages.jpg` in this
folder.

> **Content rule:** everything quoted from the screenshots (video titles,
> channel names, handles, counts, chat messages) is *screenshot content* —
> evidence of layout only. None of it is app data, none of it may be copied
> into code, seed data, or fixtures. Counts such as "699 watching" were the
> real numbers of that stream at capture time and must never be reused as
> displayed data in the app. The user's personal watch-history titles
> (screenshot 04) are not reproduced in this document at all — layout only.

---

## Source of truth — read this first

- **Android APP:** these native-app screenshots are the source of truth and
  **supersede** the earlier mobile-web audit for every app screen.
- **PWA:** the earlier mobile-web audit (`m.youtube.com`: 3-item labelled
  bottom bar, edge-to-edge feed, no live chat) remains the reference for the
  PWA only.
- **Desktop:** the earlier desktop audit remains the reference for wide
  layouts.
- Typography everywhere in the screenshots is the Android system sans
  (Roboto): card titles semibold, metadata regular grey, handles regular.
  This matches `typography.fontFamily` in `src/theme/tokens.ts`.

### Material differences: native app (these screenshots) vs mobile-web audit

1. **Bottom navigation:** native = **4 icon-only slots, no text labels** —
   Home (filled house), Shorts glyph, a **circled + (Create)**, and the
   user's **profile avatar** as the "You" tab. Mobile web = 3 labelled items
   (Home / Shorts / You), no Create button, no avatar.
2. **Feed cards carry an inline engagement row** (thumbs-up, comment bubble,
   bookmark, •••) inside the card body. Neither classic YouTube nor the
   mobile-web feed has this row.
3. **Secondary tab row:** native home/subs screens show a text pill row —
   **Home / Subs / Music / Live / More** — selected item on a pale pill,
   unselected items plain text, no pill background. Mobile web showed a
   scrollable category-chip row preceded by a square Explore (compass)
   button; there is no Explore button here.
4. **Top bar (signed in):** cast icon, notifications bell with a red **9+**
   badge, and search magnifier at right; the wordmark reads "Premium"
   (red play mark + black text) because the account is Premium. Mobile web
   signed-out showed only a search icon — no cast, no bell, no badge.
5. **Live chat exists on mobile.** In the native app it appears both as a
   **Live chat card** under the player on the watch page and as a **bottom
   sheet** over the player. The mobile-web audit found no live chat anywhere
   on mobile.
6. **Watch-page action row:** native = channel avatar + a **Subscribed pill
   (bell + chevron)**, then icon-only Like / Dislike / Share / **sparkle
   (Ask)** / ••• with no counts or labels (the like count lives in the
   metadata line). Mobile web had Like/Dislike/Share/Save/Report icons and
   no Subscribed pill in the action row.
7. **Search results:** native leads with a full **channel result block**
   (Subscribed + View Channel pills, "Latest videos" carousel, avatar LIVE
   ring). Mobile-web results were plain video rows under a grey query pill.
8. **"You" page:** native = a full Library page (Accounts selector, History
   shelf, Library filter chips, stacked playlist cards). Mobile-web "You"
   signed-out was effectively a sign-in prompt.
9. **Subscriptions screen:** native has a **channel avatar rail with
   live/new dots**, a "Most relevant" heading and a Shorts shelf — none of
   these appeared in the mobile-web audit.
10. **Thumbnail treatment splits by surface:** native **Home** feed
    thumbnails are full-bleed edge-to-edge, while **Subscriptions** and
    **Search** thumbnails are inset (≈16px side margins, ≈12px radius).
    Mobile-web feed thumbnails were edge-to-edge everywhere.
11. **Page tint:** native light theme is not flat white everywhere — the
    You page carries a warm cream tint at the top and Search a pale cool
    tint (account/Premium theming). Mobile web was flat white. For
    Haftawari Samagam: keep flat theme surfaces; the tint is account
    theming, not layout.

---

## Global geometry (all screenshots, 1080px-wide captures)

- Status bar is the Android system bar (not app UI).
- App top bar ≈ 56px tall, white, no visible bottom border; content starts
  immediately below it.
- Standard side padding for card bodies / inset surfaces: **≈16px**.
- Card title: ≈16–17px, weight 600, max 2 lines, then ellipsis.
- Metadata line: ≈13–14px, regular, grey (`textSecondary`).
- Handles: ≈14px regular grey, truncated with ellipsis when long.
- Icon size in rows (engagement, actions): ≈24px, black outline style.
- Bottom nav: white/translucent bar ≈56–64px + gesture bar below, thin
  top hairline; 4 evenly spaced slots (see §1).

---

## 1. Home feed — `01-mobile-home-feed.jpg`

**Top bar, left → right:** red play mark + "Premium" wordmark (black);
right side: cast icon, bell with red pill badge "9+" overlapping its top
right, search magnifier. Icons ≈24px, spaced ≈20–24px.

**Secondary tab row** directly under the top bar: text pills
**Home / Subs / Music / Live / More**, ≈16px text. Selected ("Home") sits
on a pale pink-grey pill (fully rounded, ≈16px horizontal padding);
unselected items are plain black text with no background. Row is
horizontally scrollable in principle; 5 items fit here.

**Feed card (the style Phase 2 must reproduce):**
- Thumbnail: **full-bleed, edge-to-edge**, 16:9. On a live item, a red
  **((•)) LIVE pill** sits at the thumbnail's **bottom-right** (≈8px inset,
  white broadcast glyph + "LIVE", radius ≈6px). On a recorded item, a dark
  translucent **duration pill** in the same position (white text, e.g.
  "20:30" — screenshot content).
- Card body (white) below the thumbnail, ≈16px side padding, ≈12px gap
  from thumbnail:
  - **Title:** 2 lines, bold/semibold ≈17px, black.
  - **Row:** circular channel avatar ≈40px at left; beside it the
    **@handle** (grey, truncated) on line 1 and the **watching/views line**
    on line 2 ("591 watching" on the live card — screenshot content; a
    recorded card shows "▷ 12K · 21 hr ago" and may add a third sub-line
    such as "Auto-dubbed" with a small icon).
  - **Inline engagement row, right-aligned on the avatar row:**
    thumbs-up outline, comment bubble (with lines), bookmark outline,
    horizontal ••• — ≈24px icons, ≈20px apart, **no counts, no labels**.
- Cards are separated by whitespace; the next card's thumbnail begins
  ≈16–24px below the previous card's engagement row. There is no visible
  card border or shadow — separation is by spacing and the full-bleed
  thumbnail.

**Bottom navigation (as shown here and in 02–04):** 4 slots, **icons
only, no text labels**: filled house (Home, active), Shorts glyph,
**circled +** (plus inside a thin circle outline), circular **profile
avatar** (the signed-in user's own picture — screenshot content). Bar is
white with a faint top edge; the Android gesture pill sits below it.

---

## 2. Subscriptions — `02-mobile-subscriptions.jpg`

- Top bar identical to §1. Secondary tab row identical, with **"Subs"**
  selected (pale pill).
- **Channel avatar rail** under the tab row, horizontally scrollable:
  avatars ≈64px (circles; a channel whose logo is square shows rounded
  square), channel name truncated below each (≈11–12px, one line, e.g.
  "AMRITV…"). A **red dot** (≈14px, white ring) overlaps the avatar's
  bottom-right = channel is live; a **blue dot** in the same position =
  new content (one avatar in the screenshot shows blue). Rail ends with a
  blue **"All"** text link.
- **"Most relevant"** section heading: ≈20px, weight 600, ≈24px above the
  first shelf.
- **Shelf cards are a horizontal carousel:** card width ≈78% of the
  screen (next card peeks at the right edge). Thumbnail **inset** with
  ≈16px margins shared with the row, radius ≈12px, ((•)) LIVE pill
  bottom-right on live items. Below: title 2 lines semibold with a **•••
  at the title's right**, then channel name (grey, with verified/music
  badge glyph where applicable) + "▷ N watching" on one grey line.
  No engagement row on these shelf cards.
- **Shorts shelf:** red Shorts logo glyph + "Shorts" (≈18px semibold) +
  chevron ">" as the shelf header. Cards are vertical **9:16**, ≈47% of
  screen width each (two visible + peek), radius ≈12px, with a small
  white ••• overlay at the thumbnail's top-right.

---

## 3. Search — channel result — `03-mobile-search-channel-result.jpg`

**Search bar row (replaces the app top bar):** back arrow at left; a
**pill search field** (light grey fill, fully rounded) holding the query
text ("bgsj" — screenshot content) with an **× (clear)** inside its right
end; then a **microphone icon in a light circle**, a **cast icon**, and a
**vertical 3-dot** menu. All ≈24px.

**Channel result block** (page background carries a pale cool tint):
- Row: circular avatar ≈88px at left; right of it the channel name in
  ≈20px bold, up to 2 lines, with a **music-note verified badge** after
  the name; below, the @handle (grey), then one grey line
  "subscribers • videos" (Indian-format counts — screenshot content).
- **Button row, two pills side by side, ≈48% width each, ≈44px tall:**
  - **Subscribed** — light grey fill; filled bell icon + "Subscribed" +
    chevron-down.
  - **View Channel** — transparent with a thin outline border, dark text.
- **"Latest videos"** heading ≈18px semibold, ≈24px below the buttons.
- **Carousel card:** thumbnail inset (≈16px margins, radius ≈12px),
  ((•)) LIVE pill bottom-right. Under it: a small avatar ≈48px with a
  **red ring** and a small red **LIVE pill overlapping the avatar's
  bottom edge**; title 2 lines (truncated) with ••• at its right; channel
  name in grey caps-style line with badge; "N watching" grey below.
- Below the carousel, results continue as full-width cards (next item's
  thumbnail begins at the bottom of the screenshot).

---

## 4. You / Library — `04-mobile-you-library.jpg`

**Header row (no YouTube wordmark on this tab):** left, an **"Accounts"
pill** (light warm-grey fill, text + chevron-down, fully rounded);
right: bell with red "9+" badge, search magnifier, **settings gear**.
Page top carries a warm cream tint fading to white (account theming —
see Source of truth note 11).

**Profile block:** circular avatar ≈96px at left; name ≈28px bold beside
it; under the name, the @handle and a membership line in gold/olive text
("Premium member" — screenshot content; the gold colour is Premium
theming). Button row under the profile: **"View channel"** — dark
(near-black/brown) pill, white text, ≈48% width — and **"Premium
benefits"** — light pill, dark text, ≈48% width.

**History section:** heading "History" ≈20px semibold + chevron ">".
Horizontal card row: cards ≈36% of screen width; thumbnails radius
≈12px (a thin red progress bar can sit at a thumbnail's bottom edge);
title 2 lines ≈14px semibold with ••• at the title's right; channel name
grey below. *(Titles in this shelf are the user's personal watch history
— layout only, not reproduced here.)*

**Library section:** heading "Library" ≈20px semibold. **Filter chips
row** (scrollable): "Recent" with a chevron-down, "Downloaded",
"Playlists", "Music", "Courses" (cut off at the edge) — light grey
pills, dark text, ≈14px; these are filters, not selected/unselected
chips in the home-feed sense.

**Playlist rows (stacked cards):** each row = thumbnail ≈40% width,
radius ≈12px, at left, with a **stacked-card edge effect** — a slightly
smaller, offset rounded layer peeking behind the thumbnail's top edge,
suggesting a stack of videos. Right of the thumbnail: playlist title
≈18px medium ("Liked videos", "Downloads", "Watch later" — these are
YouTube's standard library playlists), with "Private" in grey under
Liked/Watch later, and a ••• at the row's far right. The "Downloads"
thumbnail carries a large white **download-arrow overlay** centred on
it; the "Liked videos" thumbnail carries a small **thumbs-up badge in a
dark circle** at its bottom-right.

**Bottom nav:** same 4-slot bar as §1, with the **profile avatar slot
active** on this tab (Home icon shown in outline style here).

---

## 5. Live watch page — `06-mobile-live-watch.jpg`

- **Player pinned at the top**, full width, 16:9, black letterbox area
  is the video itself; a thin **red progress line** runs along the
  player's bottom edge. A small circular channel watermark sits at the
  player's top-right (part of the stream's own overlay graphics —
  screenshot content, not app UI).
- **White sheet with rounded top corners (≈16–20px radius) overlaps the
  player's bottom edge**; all watch content lives on this sheet, ≈16px
  side padding:
  - **Title:** one visible line, ≈20px, weight ≈500–600, truncated at
    the right edge (no wrap in this state).
  - **Metadata line** (≈14px grey, single line): @handle + verified
    music badge · "N likes" · "N watching" · hashtag · **"more"**
    (the description expander). All numbers are screenshot content.
  - **Action row:** at left, channel avatar ≈40px + the **Subscribed
    pill** (light grey fill, bell icon + chevron-down). Right-aligned
    icon group, ≈24px outline icons, evenly spaced: **Like, Dislike,
    Share (curved arrow), sparkle (Ask), •••**. No counts or labels.
  - **Live chat card:** an inset container, light grey fill, radius
    ≈16px, ≈12px internal padding. Header row: "Live chat" ≈16px
    medium at left; at right a small **toggle/pagination dots** control
    (one dark pill dot + one light dot). Below: the signed-in user's
    avatar ≈36px + a lighter **input pill** reading "Chat publicly as
    <own channel name>…" (the name shown is the user's own — screenshot
    content; reproduce the pattern, never the name).
- **Up Next continues below the chat card as full cards** — no "Up Next"
  heading. First item: full-width thumbnail with a duration pill
  bottom-right, avatar + 2-line title + ••• row, channel · views · age
  line. A following row shows the channel-row variant: avatar with red
  LIVE ring + LIVE badge, channel name + badge, age line, vertical
  3-dot at right, and a blue hyperlink line under it (screenshot
  content, omitted here).

---

## 6. Live chat bottom sheet — `05` (opening) & `07` (messages)

The sheet slides over the player; the player stays visible above it
(sheet top starts below the player, whose red progress line remains
visible at the sheet's top edge).

**Sheet chrome:**
- White sheet, **rounded top corners ≈16–20px**, with a centred **drag
  handle** (grey pill ≈48×4px) at its top.
- Header row: **"Live chat"** ≈24px bold at left. Right side, ≈24px
  icons spaced ≈24px: **crown** (top-fans/leaderboard), **sliders**
  (two horizontal toggle lines — chat settings), **×** (close).
- Sub-line under the title: **"Top messages"** (grey, ≈14px) + a
  **person icon + participant count** (grey). The count in the
  screenshots (699) was that stream's real participant count at capture
  time — **do not reuse it**; the app shows its own real presence count.
- In `07` the crown icon sits inside a **light grey pill** (selected
  state) — the leaderboard view is active; in `05` it is unselected.
- In `05` the message area below the header is an empty light-grey
  field (messages not yet rendered in that frame) — i.e. the sheet has
  a distinct, slightly grey body area while loading.

**Message rows (`07`):**
- Row layout: circular avatar ≈36px at left (photo avatar, or a
  **coloured circle with a white initial** — teal, green, magenta,
  purple, orange fills); then, on one flowing text block, the **@handle
  in bold grey-dark ≈14px** followed by the message text in regular
  black ≈14px, wrapping to the avatar's right edge (continuation lines
  align with the handle, not the avatar).
- Vertical rhythm: ≈10–12px between rows; emoji render inline at text
  size.
- **Badges:** a message can carry a red pill badge after the handle —
  crown glyph + "#2" in white bold (top-fan ranking; screenshot
  content) — badge height ≈20px, fully rounded.
- **Notice box** above the input: light grey fill, radius ≈12px,
  ≈13px text explaining subscribers-only mode, ending with a blue
  "Learn more" link. (The app equivalent is our own session-chat rules
  notice — wording is ours, layout is this box.)
- **Floating reaction button:** white circle ≈56px with soft shadow and
  a red heart, overlapping the notice box's right edge / floating above
  the input row at the right.
- **Input row:** a light grey pill field, placeholder "Chat…", with an
  **emoji (smiley) icon inside its right end**; to its right a separate
  circular button holding a **$ -in-rectangle icon** (paid Super Chat in
  YouTube; in Haftawari Samagam this slot is not carried over unless a
  free equivalent is designed — layout noted for fidelity only).

---

## Phase 2 implementation checklist (derived from this reference)

- [ ] BottomNav (app): 4 icon-only slots — Home, Shorts, circled +, avatar.
- [ ] SecondaryTabs component: Home / Subs / Music / Live / More text pills.
- [ ] FeedCard (home): full-bleed thumbnail, LIVE/duration pill bottom-right,
      engagement row (like / comment / save / •••) in the card body.
- [ ] ShelfCard (subs/search): inset thumbnail radius 12, no engagement row.
- [ ] AvatarRail with red (live) / blue (new) dots + "All" link.
- [ ] ChannelResult block: Subscribed pill (bell + chevron) + View Channel
      outline pill; avatar LIVE ring + LIVE badge overlap.
- [ ] You/Library: Accounts pill, History shelf, Library filter chips,
      stacked playlist rows with offset stack edge.
- [ ] Watch: sheet with rounded top corners over the player; Subscribed pill
      + icon-only action row incl. sparkle; Live chat card with input pill.
- [ ] ChatSheet: drag handle, crown / sliders / × header, Top messages +
      real participant count, coloured-initial avatars, badge pill, notice
      box, floating heart reaction, Chat… pill with emoji button.
- [ ] Session wording stays truthful per the Master Prompt: the app's own
      sessions use UPCOMING / NOW PLAYING / COMPLETED; the ((•)) LIVE pill
      and "watching" language in this document describe the *reference*
      UI of genuinely live YouTube streams.

---

## Corrections from direct screenshot study (Phase 2 — screenshot wins)

The 7 JPGs were re-studied directly during Phase 2. Where the catalogue
above and a screenshot disagreed, the screenshot governed and the code
follows the screenshot:

1. **§1 Home feed card:** the title is **full-width ABOVE the avatar
   row** (title block first, then avatar + @handle/watching lines +
   engagement row). Any reading of §1 as "title beside the avatar" is
   wrong; FeedCard implements title-full-width.
2. **§6 Chat sheet drag handle:** ≈**90×5px**, not 48×4. Token
   `nativeApp.watchSheet.dragHandleWidth/Height` corrected to 90/5.
3. **§5 Watch sheet top radius:** reads ≈**20px** in screenshot 06;
   token `nativeApp.watchSheet.topRadius` corrected 16 → 20.
4. **§1/§2 metadata lines** begin views with a "▷" glyph
   ("▷ 12K · 21 hr ago", "▷332 watching") — implemented in card data
   formatting for API-sourced items.
5. **§3 channel counts** are Indian-format ("4.65 lakh subscribers •
   7.2K videos") — implemented via `formatCount` in src/lib/format.ts.

## User decision overriding this reference (26 Nov 2026): NO SHORTS

The user decided the app has **no Shorts anywhere** ("Shorts nhi hone
chahide"). This overrides Master Prompt §7 and this reference (which
documents YouTube, Shorts included, for layout evidence only):

- No Shorts screen or route; `src/screens/shorts/` deleted.
- Bottom nav slot 2 is **Subscriptions** (icon-only, same geometry);
  Home, circled + and avatar slots unchanged.
- No Shorts item in the desktop sidebar; no Shorts tab on the channel
  page (Videos / Live only); no Shorts shelf on Home or Subscriptions.
