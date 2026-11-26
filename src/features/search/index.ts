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
  fetchChannelTitles,
  matchOfficialChannel,
  parseIso8601Duration,
  searchChannelVideos,
} from './youtubeSearch';
export { searchAll, createSearchController, queryKey, type SearchController } from './engine';
export { getSuggestions } from './suggestions';
export {
  listSearchHistory,
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
