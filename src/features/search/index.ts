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
  searchChannelVideosWithFallback,
  searchUploadsFallback,
  type YoutubeLegOutcome,
} from './youtubeSearch';
export {
  YouTubeApiError,
  degradedBannerText,
  type YouTubeErrorClass,
} from './youtubeError';
export {
  searchAll,
  searchYoutubeOnly,
  mergeRankedResults,
  createSearchController,
  queryKey,
  deriveCorrection,
  type SearchController,
} from './engine';
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
