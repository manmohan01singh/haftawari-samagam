/**
 * Design tokens measured from the audited YouTube UI
 * (desktop + mobile audits, 26 Nov 2026). These are layout facts —
 * header height, sidebar widths, thumbnail geometry — not copied assets.
 */

export const layout = {
  /** Desktop + mobile top header height. */
  headerHeight: 56,
  /** Desktop sidebar, expanded. */
  sidebarExpandedWidth: 240,
  /** Desktop sidebar, collapsed ("mini guide"). */
  sidebarCollapsedWidth: 72,
  /** Desktop watch page secondary (right) column width range. */
  watchSecondaryColumnWidth: 420,
  /** Page gutter on desktop. */
  pageGutter: 24,
  /** Gap between video cards in the desktop grid. */
  gridGap: 16,
  /** Gap inside a video card (thumbnail → avatar/title row). */
  cardInnerGap: 12,
  /** Video thumbnail / player aspect ratio, 16:9. */
  thumbnailAspectRatio: 16 / 9,
  /** Channel avatar sizes. */
  avatarSm: 36,
  avatarMd: 40,
  avatarLg: 160,
  /** Mobile bottom navigation height (excluding safe-area inset). */
  bottomNavHeight: 56,
} as const;

export const radii = {
  /** Thumbnails, player, chat panel. */
  card: 12,
  /** Channel banner. */
  banner: 16,
  /** Buttons, chips, search field — fully rounded. */
  pill: 999,
  /** Duration / status badge on a thumbnail. */
  badge: 4,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Roboto-style type scale (system sans on Android is Roboto;
 * web falls back to Roboto / system-ui — see fontFamily below).
 */
export const typography = {
  fontFamily: 'Roboto, System, system-ui, sans-serif',
  watchTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  channelName: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
  metadata: { fontSize: 12, lineHeight: 18, fontWeight: '400' as const },
  chip: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' as const },
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceVariant: string; // chips, description box, segmented pills (#f2f2f2-style in light)
  text: string;
  textSecondary: string;
  border: string;
  accent: string; // reserved: NOW PLAYING badge, player progress
  onAccent: string;
  subscribeBackground: string;
  subscribeText: string;
  selectedChipBackground: string;
  selectedChipText: string;
  playerBackground: string;
}

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceVariant: '#F2F2F2',
  text: '#0F0F0F',
  textSecondary: '#606060',
  border: '#E5E5E5',
  accent: '#FF0000',
  onAccent: '#FFFFFF',
  subscribeBackground: '#0F0F0F',
  subscribeText: '#FFFFFF',
  selectedChipBackground: '#0F0F0F',
  selectedChipText: '#FFFFFF',
  playerBackground: '#000000',
};

export const darkColors: ThemeColors = {
  background: '#0F0F0F',
  surface: '#0F0F0F',
  surfaceVariant: '#272727',
  text: '#F1F1F1',
  textSecondary: '#AAAAAA',
  border: '#303030',
  accent: '#FF0000',
  onAccent: '#FFFFFF',
  subscribeBackground: '#F1F1F1',
  subscribeText: '#0F0F0F',
  selectedChipBackground: '#F1F1F1',
  selectedChipText: '#0F0F0F',
  playerBackground: '#000000',
};

export const theme = {
  layout,
  radii,
  spacing,
  typography,
  light: lightColors,
  dark: darkColors,
} as const;
