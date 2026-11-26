/**
 * Search engine — public API for the SearchScreen.
 * Wiring contract: docs/SEARCH.md.
 */

export { OFFICIAL_CHANNEL, uploadsPlaylistId } from './config';
export { normalizeText, tokenize, compactText, acronymOf } from './normalize';
export {
  DEFAULT_THRESHOLD,
  levenshtein,
  tokenSimilarity,
  scoreTitle,
  rankByTitle,
  type MatchKind,
  type TitleMatch,
  type RankedItem,
} from './fuzzy';
export {
  fetchPublishedVideos,
  invalidateCatalogueCache,
  isShortForm,
  searchLocalCatalogue,
} from './localCatalogue';
export {
  fetchOfficialChannel,
  fetchChannelCard,
  fetchChannelTitles,
  fetchChannelTitlesFor,
  matchOfficialChannel,
  matchChannel,
  parseIso8601Duration,
  searchChannelVideos,
  searchChannelVideosFor,
  type ChannelIdentity,
} from './youtubeSearch';
export { loadSearchChannels, MAX_YOUTUBE_SEARCH_CHANNELS } from './channelRegistry';
export { searchAll, createSearchController, queryKey, deriveCorrection, type SearchController } from './engine';
export { getSuggestions } from './suggestions';
export {
  listSearchHistory,
  listSearchHistoryEntries,
  type SearchHistoryEntry,
  addSearchHistory,
  removeSearchHistory,
  clearSearchHistory,
} from './history';
export type {
  ChannelResult,
  VideoResult,
  SearchResults,
  SearchOptions,
  Suggestion,
} from './types';
