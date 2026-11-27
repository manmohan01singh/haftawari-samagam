/**
 * Single source of truth for branding.
 *
 * The working name is "Haftawari Samagam". To rename the product later,
 * change the values in THIS file (plus the display name in app.json) —
 * no other source file should hard-code the product name.
 *
 * Branding is deliberately independent of YouTube's identity: this is a
 * YouTube-inspired layout with its own name, colours and identity.
 */
export const branding = {
  /** Product / app display name (working name, refinable later). */
  appName: 'Haftawari Samagam',
  /** Short name used in compact headers and the PWA manifest. */
  shortName: 'Haftawari',
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
