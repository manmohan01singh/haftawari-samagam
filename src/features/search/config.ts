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
    // The channel's own daily programme terms: the Amritvela (early-
    // morning Simran Sadhna) samagams are this channel's core content
    // and the app's own vocabulary, so a search for the programme
    // names the channel — its card + Latest videos belong on the
    // results (round-3 fix: "Amritvela" returned no channel card).
    'amritvela',
    'amrit vela',
    'amritvela samagam',
  ],
} as const;

/** Uploads playlist id for a channel: "UU" + channel id minus "UC". */
export function uploadsPlaylistId(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}
