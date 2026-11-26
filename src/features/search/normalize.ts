/**
 * Text normalization for search.
 *
 * Pure module — no React Native imports — so it can be unit-verified from
 * plain Node (see scripts/verify-search.mjs).
 *
 * Titles in this catalogue are mostly romanized Punjabi / English
 * transliteration ("Kal Taaran Gur Nanak Aaya"), sometimes with Gurmukhi
 * script. Normalization therefore:
 *   - lowercases and strips Latin diacritics (ā → a) so typed queries
 *     without special characters still match;
 *   - treats punctuation as token separators ("(30/11/20)" → 30 11 20);
 *   - keeps Gurmukhi letters intact (they are letters, not punctuation);
 *   - collapses all whitespace.
 */

/** Normalize a string for comparison. Never use for display. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    // Strip combining diacritics from Latin letters (NFD split first).
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    // Anything that is not a letter or number (any script) is a separator.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Split a string into normalized tokens. */
export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/** Tokens joined with no separator — catches spacing differences. */
export function compactText(input: string): string {
  return tokenize(input).join('');
}

/** First letters of each token, e.g. "Bhai Gursharan Singh Ji" → "bgsj". */
export function acronymOf(input: string): string {
  return tokenize(input)
    .map((token) => token.charAt(0))
    .join('');
}
