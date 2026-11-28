/**
 * Content-level dedupe (blueprint round 2, faults 4 / 23 / N9 /
 * N10): videoId dedupe cannot catch the same programme uploaded
 * more than once — different IDs, each with its own true
 * statistics — yet a feed showing the same clip three times in
 * five slots reads as broken, and its like counts "flap" because
 * each copy carries its own rows.
 *
 * The content key is channel + normalised title + duration (exact
 * when both durations are known): same channel, same title, same
 * length = the same programme re-uploaded. A different duration
 * means a genuinely different edit/broadcast (a 0:30 clip vs the
 * 2:23:49 full programme) and is NEVER deduped away.
 */
export function contentKeyFor(
  channelId: string | null | undefined,
  title: string,
  durationSeconds: number | null | undefined,
): string | null {
  if (!channelId || durationSeconds == null || durationSeconds <= 0) return null;
  const normalisedTitle = title.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalisedTitle) return null;
  return `${channelId}|${normalisedTitle}|${durationSeconds}`;
}

/**
 * Keep the first item per content key; later same-key items are
 * dropped. Items whose key cannot be computed (missing channel or
 * duration) are always kept.
 */
export function dedupeByContent<T>(
  items: readonly T[],
  keyOf: (item: T) => string | null,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key != null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(item);
  }
  return out;
}

/** Hard title normalisation for fuzzy matching: case, punctuation,
 *  emoji and extra whitespace all washed out. */
export function normaliseTitleHard(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy content dedupe for finite pools (fix round 4, Chat 2 #23;
 * tolerance widened in round 5 — the same Takhat Sahib Short still
 * appeared twice at 1K/2.4K views because the re-upload was
 * trimmed by more than 3 s): same channel + same hard-normalised
 * title + durations within ±10 s = the same clip re-uploaded.
 * Items missing channel or duration are always kept; genuinely
 * different lengths (a 0:30 clip vs the full programme) are far
 * outside the tolerance and stay.
 */
export function dedupeByContentFuzzy<T>(
  items: readonly T[],
  partsOf: (item: T) => { channelId: string | null; title: string; durationSeconds: number | null },
): T[] {
  const kept: { channelId: string; title: string; durationSeconds: number }[] = [];
  const out: T[] = [];
  for (const item of items) {
    const parts = partsOf(item);
    if (!parts.channelId || parts.durationSeconds == null || parts.durationSeconds <= 0) {
      out.push(item);
      continue;
    }
    const title = normaliseTitleHard(parts.title);
    if (!title) {
      out.push(item);
      continue;
    }
    const dupe = kept.some(
      (k) =>
        k.channelId === parts.channelId &&
        k.title === title &&
        Math.abs(k.durationSeconds - (parts.durationSeconds as number)) <= 10,
    );
    if (dupe) continue;
    kept.push({ channelId: parts.channelId, title, durationSeconds: parts.durationSeconds });
    out.push(item);
  }
  return out;
}
