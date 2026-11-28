/**
 * Single source of truth for branding.
 *
 * RENAMED (user, 28 Nov 2026): the product is now "YouTube Gurbani" —
 * the header wordmark reads "YouTube" with a small "Gurbani" suffix,
 * in the same bold, tight style as the reference. The user chose
 * this name with the trademark risk stated plainly beforehand (it
 * is Google's brand; the site/repo are his, and the choice was his).
 * Change the values in THIS file (plus the display name in app.json)
 * to rename again — no other source file should hard-code the name.
 */
export const branding = {
  /** Product / app display name. */
  appName: 'YouTube Gurbani',
  /** Main wordmark word (compact headers, PWA manifest short name). */
  shortName: 'YouTube',
  /** Small suffix rendered beside the main wordmark in the header. */
  wordmarkSuffix: 'Gurbani',
  /** One-line description used in app.json / PWA manifest. */
  tagline: 'Haftawari and Amritvela kirtan samagams, scheduled and shared.',
  /** Channel identity shown inside this app (this app's own archive). */
  channelName: 'Haftawari Samagam',
  channelHandle: '@haftawarisamagam',
  /**
   * Accent red, used sparingly: the NOW PLAYING badge and the player
   * progress indicator. Matches the audited reference value #FF0000.
   */
  accentRed: '#FF0000',
  /**
   * Brand colours of the app's own jot emblem (Phase 9, forensic
   * audit D1): deep maroon tile + gold flame. Deliberately NOT
   * YouTube red — the header mark and adaptive icon use these.
   */
  brandMaroon: '#640B19',
  brandGold: '#E8A33D',
  /** PWA / splash background. */
  backgroundColor: '#FFFFFF',
} as const;

export type Branding = typeof branding;
