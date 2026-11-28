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
