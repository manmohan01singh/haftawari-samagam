/**
 * Fuzzy title scoring — the heart of the search engine.
 *
 * Pure module — no React Native imports — so it can be unit-verified from
 * plain Node (see scripts/verify-search.mjs).
 *
 * Design (YouTube-like tolerance, tuned for transliterated kirtan titles):
 *   1. Exact phrase  — the normalized query appears verbatim in the title.
 *   2. Compact match — query tokens appear with different spacing
 *      ("kal taran" vs "Kal Taaran": token-level fuzzy handles the rest).
 *   3. Acronym       — "bgsj" matches "Bhai Gursharan Singh Ji": the query
 *      equals (or prefixes) the title's initial letters. This is also how
 *      the channel card is triggered.
 *   4. Token match   — every query token is scored against its BEST title
 *      token (so word order never matters), where a token pair scores by:
 *      equality = 1, prefix (≥3 chars) ≈ 0.85–0.95, otherwise a
 *      Levenshtein-ratio with a length-difference guard. The title score
 *      is the mean of the per-token bests, lightly penalized when the
 *      title is much longer than the query.
 *
 * A hand-rolled scorer is used instead of a generic fuzzy library because
 * the acronym rule and the per-token best-match rule are specific to this
 * catalogue and to how the sangat actually types ("haftawri", "bgsj",
 * reordered words). Scores are in [0, 1]; DEFAULT_THRESHOLD is the
 * cut-off below which a title is not a result at all.
 */

import { acronymOf, compactText, normalizeText, tokenize } from './normalize';

export type MatchKind = 'exact' | 'phrase' | 'acronym' | 'fuzzy' | 'none';

export interface TitleMatch {
  score: number;
  kind: MatchKind;
}

export const DEFAULT_THRESHOLD = 0.45;

/** Bounded Levenshtein distance (bails out early past maxDistance). */
export function levenshtein(a: string, b: string, maxDistance = Infinity): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1, // deletion
        current[j - 1] + 1, // insertion
        previous[j - 1] + cost, // substitution
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** Similarity of two single tokens, in [0, 1]. */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  // Prefix match ("simran" ~ "simran", "abh" ~ "abhyaas"): strong signal,
  // scaled so a 3-char prefix of a long word is good but not perfect.
  if (shorter.length >= 3 && longer.startsWith(shorter)) {
    return 0.8 + 0.2 * (shorter.length / longer.length);
  }
  // Edit-distance ratio. Allow more edits on longer tokens.
  const maxDistance = longer.length <= 4 ? 1 : longer.length <= 7 ? 2 : 3;
  const distance = levenshtein(a, b, maxDistance);
  if (distance > maxDistance) return 0;
  return 1 - distance / Math.max(a.length, b.length);
}

/**
 * Score how well `query` matches `title`.
 * Returns score 0 and kind 'none' for empty input.
 */
export function scoreTitle(query: string, title: string): TitleMatch {
  const q = normalizeText(query);
  const t = normalizeText(title);
  if (q === '' || t === '') return { score: 0, kind: 'none' };
  if (q === t) return { score: 1, kind: 'exact' };

  // Phrase: verbatim substring (covers Gurmukhi titles too — the query
  // and title go through the same normalization).
  if (t.includes(q)) {
    // Earlier and tighter phrase matches rank slightly higher.
    const tightness = 1 - 0.1 * Math.min(1, (t.length - q.length) / Math.max(t.length, 1));
    return { score: 0.98 * tightness + 0.02, kind: 'phrase' };
  }

  // Compact: same letters, different spacing ("kaltaran" ~ "kal taaran").
  const qCompact = compactText(query);
  const tCompact = compactText(title);
  if (qCompact.length >= 4 && tCompact.includes(qCompact)) {
    return { score: 0.95, kind: 'phrase' };
  }

  // Acronym: "bgsj" ~ "Bhai Gursharan Singh Ji".
  const acronym = acronymOf(title);
  if (
    qCompact.length >= 2 &&
    (acronym === qCompact || (qCompact.length >= 3 && acronym.startsWith(qCompact)))
  ) {
    return { score: 0.92, kind: 'acronym' };
  }

  // Token match: order-free, per-token best.
  const qTokens = tokenize(query);
  const tTokens = tokenize(title);
  if (qTokens.length === 0 || tTokens.length === 0) return { score: 0, kind: 'none' };

  const perToken = qTokens.map((qToken) => {
    let best = 0;
    for (const tToken of tTokens) {
      const sim = tokenSimilarity(qToken, tToken);
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    return best;
  });
  let score = perToken.reduce((a, b) => a + b, 0) / qTokens.length;
  // One-wrong-word allowance (user report, 28 Nov 2026): "karta purakh
  // vkhaniye" must still find "Vich Karta Purakh Khloa | ..." — two of
  // three query words match the title EXACTLY and the third is the
  // user's own rendering of a word the title spells differently. Real
  // search engines forgive one bad token when the rest match strongly;
  // with 3+ tokens, score by the mean EXCLUDING the worst token,
  // lightly discounted. Junk queries are unaffected: every token weak
  // keeps the plain mean low either way.
  if (qTokens.length >= 3) {
    const sorted = [...perToken].sort((a, b) => a - b);
    const excludingWorst = sorted.slice(1).reduce((a, b) => a + b, 0) / (sorted.length - 1);
    score = Math.max(score, excludingWorst * 0.92);
  }
  // A query token that matches nothing at all should hurt badly — but
  // only when the overall match is not already strong (the case above).
  const worst = Math.min(...perToken);
  if (worst < 0.4 && score < 0.75) score *= 0.6;
  // Mild length penalty: a short query matching one word of a very long
  // title is weaker than matching most of a short title.
  const coverage = Math.min(1, qTokens.length / tTokens.length);
  score *= 0.85 + 0.15 * coverage;

  return { score, kind: score > 0 ? 'fuzzy' : 'none' };
}

export interface RankedItem<T> {
  item: T;
  score: number;
  kind: MatchKind;
}

/** Rank items by title score, dropping anything below the threshold. */
export function rankByTitle<T>(
  query: string,
  items: readonly T[],
  getTitle: (item: T) => string,
  threshold: number = DEFAULT_THRESHOLD,
): RankedItem<T>[] {
  const ranked: RankedItem<T>[] = [];
  for (const item of items) {
    const { score, kind } = scoreTitle(query, getTitle(item));
    if (score >= threshold && kind !== 'none') ranked.push({ item, score, kind });
  }
  return ranked.sort((a, b) => b.score - a.score);
}
