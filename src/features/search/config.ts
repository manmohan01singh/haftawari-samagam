/**
 * The ONE official channel this app is built around.
 *
 * Identity verified live against the YouTube Data API v3 on 2026-11-26
 * (channels.list?forHandle=@bhaigursharansinghjiofficial): channel id,
 * title and handle below are the API's own values. Subscriber/video
 * counts are NOT stored here — they change; the engine fetches them live
 * (cached) via channels.list.
 */
export const OFFICIAL_CHANNEL = {
  id: 'UCu7xpk9fOQRs4AvYEOakBfg',
  handle: '@bhaigursharansinghjiofficial',
  /** The channel's own title, as returned by the API. */
  title: 'BHAI GURSHARAN SINGH JI (OFFICIAL CHANNEL)',
  /**
   * Extra name forms the sangat actually types. Used ONLY for matching
   * the channel card — never displayed.
   */
  aliases: [
    'bhai gursharan singh ji',
    'bhai gursharan singh',
    'gursharan singh ji',
    'gursharan singh',
    'bgsj',
    'bhai sahib',
    'ludhiana wale',
    'bhai gursharan singh ji ludhiana wale',
    // REMOVED (Phase 13 regression fix): 'amritvela', 'amrit vela',
    // 'amritvela samagam'. These were added in the round-3 fix when
    // BGSJ was the ONLY channel and "Amritvela" returned no card.
    // The real Amritvela channels (Amritvela Trust Live / Amritvela
    // Trust) are in the registry now, and this channel's alias-exact
    // match (score 1.0) was beating their own title matches for the
    // single card slot — searching "amritvela" showed the BGSJ card.
    // The rightful owners win the term now (see matchChannel's
    // source weighting, which also covers the stale aliases still
    // sitting in the DB channels row until they are stripped).
  ],
} as const;

/** Uploads playlist id for a channel: "UU" + channel id minus "UC". */
export function uploadsPlaylistId(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}
