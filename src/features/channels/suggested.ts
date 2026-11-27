/**
 * Suggested channels for the admin Channels panel — REAL channels,
 * resolved live against the YouTube Data API v3 on 2026-11-26
 * (channels.list by handle/id). These are SUGGESTIONS ONLY: nothing
 * here is active in the app until an admin taps Add, which re-resolves
 * the handle through the API and saves the fresh values. Counts below
 * are the values the API returned on the resolution date; the panel
 * labels them as such and the Add flow shows fresh counts.
 */
export interface SuggestedChannel {
  youtubeChannelId: string;
  handle: string;
  title: string;
  avatarUrl: string;
  subscriberCount: number;
  videoCount: number;
  /** Why this preset exists, in the admin's terms. */
  note: string;
}

export const SUGGESTED_CHANNELS: SuggestedChannel[] = [
  {
    youtubeChannelId: 'UCsWEj3uf31iAF_STEvO3A2A',
    handle: '@amritvelatrustlive',
    title: 'AMRITVELA TRUST LIVE',
    avatarUrl:
      'https://yt3.ggpht.com/ytc/AIdro_k7dgqAeQymKcAsj_4rdnj0t1cpZh8KQuLDb-w7mx2vfg=s800-c-k-c0x00ffffff-no-rj',
    subscriberCount: 1050000,
    videoCount: 9236,
    note: 'The live-stream channel the user asked about — its broadcasts are the ones that go live for Amritvela.',
  },
  {
    youtubeChannelId: 'UCvo6eEtGT5LehydhnMo5sKw',
    handle: '@amritvelatrust',
    title: 'AMRITVELA TRUST',
    avatarUrl:
      'https://yt3.ggpht.com/_GckLylx9mHDChMZsYZ-IcC3CiIvIazgNNR5_1dhKXFU6ZG1ahEPVCDurtqldr7YtyrStkSLOg=s800-c-k-c0x00ffffff-no-rj',
    subscriberCount: 552000,
    videoCount: 5395,
    note: 'The main Amritvela Trust channel (uploads and katha archive).',
  },
];

/** Search aliases seeded when a suggested channel is added. */
export const SUGGESTED_ALIASES: Record<string, string[]> = {
  UCsWEj3uf31iAF_STEvO3A2A: ['amritvela trust live', 'amritvela live', 'amritvela'],
  UCvo6eEtGT5LehydhnMo5sKw: ['amritvela trust', 'amritvela'],
};
