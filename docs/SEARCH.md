# SEARCH.md — Search engine: ranking, quota, wiring

The engine lives in `src/features/search/` (engine only — no screens).
The SearchScreen is owned by the core-screens stream; this document is
the contract between the two.

## What a search does

`searchAll(query)` merges three legs:

| Leg | Source | Cost | Always runs? |
|---|---|---|---|
| Channel card | channels.list (cached 6h) | 1 unit | Only when the query names the channel |
| Local catalogue | Supabase `videos` where `publish_state='published'` | 0 units | Yes |
| Channel uploads | search.list scoped to the official channel | **100 units** | Unless `localOnly`, unconfigured, or aborted |

The official channel is `UCu7xpk9fOQRs4AvYEOakBfg`
(@bhaigursharansinghjiofficial), verified live via channels.list on
2026-11-26; identity constants live in `src/features/search/config.ts`.

### Channel card

Decided **locally at zero quota cost**: the query is scored against the
channel title, its handle, and typed aliases ("bgsj", "bhai sahib",
"ludhiana wale", …). A score ≥ 0.7 is required — a stray common word
("singh") must not summon the card. When it matches, live counts come
from `fetchOfficialChannel()` (channels.list, 1 unit, AsyncStorage
cache 6h). The card's layout (avatar ≈88px, Subscribed + View Channel
pills, "Latest videos" carousel below) is reference screenshot 03 in
`docs/reference/REFERENCE_UI.md` §3.

### Ranking

Every candidate title is scored by `scoreTitle()` in `fuzzy.ts`:

1. **exact** — normalized query equals the title (1.0)
2. **phrase** — query appears verbatim, or with different spacing (≥0.9)
3. **acronym** — query equals/prefixes the title's initials, e.g.
   "bgsj" → "Bhai Gursharan Singh Ji" (0.92)
4. **fuzzy** — order-free per-token best match: equality 1, prefix
   (≥3 chars) ≈0.85–0.95, else Levenshtein ratio (edit budget grows
   with token length). A query token matching nothing (<0.4) drags the
   whole score down — a wrong word means a different video, not a typo.
   A mild coverage factor prefers titles the query covers more fully.

Normalization (`normalize.ts`) lowercases, strips Latin diacritics,
treats punctuation as separators, and keeps Gurmukhi letters intact,
so romanized and Gurmukhi queries both work.

Merged ordering (in `engine.ts`): tier first — exact/phrase local →
acronym local → fuzzy local → YouTube leg — then score, then newest.
A video present in both legs appears **once**: the local row wins
because it carries the `videos` row id the app needs for history and
saves. Results below score 0.45 are dropped.

`youtubeSkipped: true` in the result means the YouTube leg did not run
(no key, error, or abort) — the screen must present local results as
possibly incomplete, never as "everything".

### Shorts — excluded by design

There are **no Shorts anywhere in this app** (user decision 2026-11-26;
the Shorts screen/nav were removed). Search enforces it in both legs:
any candidate whose title or description carries `#shorts`, or whose
real duration is ≤ 60 seconds, is dropped. Honest limitation: the Data
API has no `isShort` flag, so this is a heuristic — it is exact for the
admin-curated local catalogue (all long recordings) and conservative
for API results.

## Quota budget (10,000 units/day, free)

| Call | Units | When | Cache |
|---|---|---|---|
| search.list | **100** | Explicit search submit only — never per keystroke | AsyncStorage, 10 min per normalized query + in-flight de-dup |
| channels.list | 1 | Channel card / channel screen | AsyncStorage, 6h |
| videos.list | 1 | Durations for one search page (Shorts filter) | Batched with the search result |
| playlistItems.list | 1/page | Channel upload titles for suggestions | AsyncStorage, 24h |

Worst realistic day: ~50 distinct submitted searches ≈ 5,000 units +
~5 units of cached calls. Suggestions cost **zero** quota: they read
the local catalogue, the user's own history, and the 24h-cached
channel titles only.

## Suggestions

`getSuggestions(prefix, { userId, limit })` → `Suggestion[]`
(`source: 'history' | 'local' | 'channel'`). Empty prefix returns the
recent-search list (like YouTube's pre-typing state). All sources are
real data; nothing is generated.

## Search history

`listSearchHistory / addSearchHistory / removeSearchHistory /
clearSearchHistory` (AsyncStorage, `@haftawari/search-history:v1:<userId|'guest'>`,
most-recent first, de-duped, cap 20). **Local only**: the Supabase
schema has no search-history table, so nothing is synced or uploaded —
if sync is ever wanted it needs a migration first.

## Wiring contract for the SearchScreen

```ts
import {
  createSearchController,   // debounce 300ms + abort of stale requests
  getSuggestions,
  addSearchHistory, listSearchHistory, removeSearchHistory, clearSearchHistory,
  type SearchResults, type Suggestion,
} from '../features/search';

// Once, e.g. in a ref:
const controller = createSearchController(300);

// As the user types (suggestions are quota-free):
const suggestions: Suggestion[] = await getSuggestions(text, { userId });

// On submit:
await addSearchHistory(text, userId);
const results: SearchResults = await controller.search(text);
// results.channel → ChannelResult card (screenshot 03 layout) or null
// results.videos  → VideoResult[] (source 'local' rows carry videoRowId
//                   for navigation/history; 'youtube' rows carry only
//                   youtubeVideoId)
// results.youtubeSkipped → show a "showing offline catalogue only" note

// On unmount / clear:
controller.cancel();
```

## Verification

`node scripts/verify-search.mjs` transpiles the pure scorer with the
project's TypeScript and asserts behaviour on the real Dec 2020
catalogue titles: `'kal taran'` top-matches "Kal Taaran Gur Nanak
Aaya", the typo `'haftawri'` resolves, token reordering, prefixes,
the `'bgsj'` acronym, a Gurmukhi phrase, and garbage matching nothing.
Exit code 1 on any FAIL.
