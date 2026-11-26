/**
 * As-you-type suggestions — REAL DATA ONLY, and quota-free:
 *   1. the user's own recent searches (AsyncStorage);
 *   2. titles from the local published catalogue (Supabase, cached);
 *   3. recent upload titles of the official channel (cached 24h —
 *      fetched by fetchChannelTitles at 1 unit/day, never per keystroke).
 *
 * search.list (100 units) is NEVER called from here. See docs/SEARCH.md.
 */

import { fetchPublishedVideos } from './localCatalogue';
import { rankByTitle, scoreTitle } from './fuzzy';
import { listSearchHistory } from './history';
import { fetchChannelTitles } from './youtubeSearch';
import type { Suggestion } from './types';

/**
 * Suggestions for a partially-typed query. An empty prefix returns the
 * recent-search list (what YouTube shows before you type).
 */
export async function getSuggestions(
  prefix: string,
  options: { userId?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<Suggestion[]> {
  const limit = options.limit ?? 8;
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (text: string, source: Suggestion['source']) => {
    const key = text.toLowerCase();
    if (seen.has(key) || suggestions.length >= limit) return;
    seen.add(key);
    suggestions.push({ text, source });
  };

  const history = await listSearchHistory(options.userId);
  const trimmed = prefix.trim();

  if (trimmed === '') {
    for (const entry of history) push(entry, 'history');
    return suggestions;
  }

  // 1. History entries the prefix plausibly starts / fuzzily matches.
  for (const entry of history) {
    if (scoreTitle(trimmed, entry).score >= 0.6) push(entry, 'history');
  }

  // 2 + 3. Catalogue and channel titles, best fuzzy matches first.
  const [videos, channelTitles] = await Promise.all([
    fetchPublishedVideos(options.signal).catch(() => []),
    fetchChannelTitles(options.signal).catch(() => [] as string[]),
  ]);
  const localRanked = rankByTitle(trimmed, videos, (video) => video.title, 0.5);
  for (const { item } of localRanked) push(item.title, 'local');
  const channelRanked = rankByTitle(trimmed, channelTitles, (title) => title, 0.5);
  for (const { item } of channelRanked) push(item, 'channel');

  return suggestions;
}
