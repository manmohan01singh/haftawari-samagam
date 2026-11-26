import { Platform, Share } from 'react-native';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

/**
 * Real share with visible-feedback outcomes (QA issue 30).
 *
 * RN's Share.share is a silent no-op on web — tapping Share on the
 * PWA did literally nothing, which read as a dead tap. This helper:
 *  - web: uses the Web Share API when the browser offers it;
 *    otherwise copies the link to the clipboard ('copied'), so the
 *    caller can show "Link copied" feedback;
 *  - native: the OS share sheet via RN Share.
 * The caller MUST surface the outcome (toast) — a share tap with no
 * visible result is the bug being fixed.
 */
export async function shareContent(title: string, url: string): Promise<ShareOutcome> {
  const text = `${title} — ${url}`;
  if (Platform.OS === 'web') {
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
      clipboard?: { writeText: (value: string) => Promise<void> };
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title, text, url });
        return 'shared';
      } catch (e) {
        // User closed the share sheet — not a failure, and not silent.
        if (e instanceof Error && e.name === 'AbortError') return 'dismissed';
        // Any other share failure falls through to the clipboard.
      }
    }
    try {
      if (nav.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        return 'copied';
      }
    } catch {
      // Clipboard denied (permissions / insecure context) — fail honestly.
    }
    return 'failed';
  }
  try {
    const result = await Share.share({ title, message: text, url });
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}

export function shareFeedback(outcome: ShareOutcome): string | null {
  switch (outcome) {
    case 'shared':
      return 'Shared';
    case 'copied':
      return 'Link copied — paste it anywhere to share';
    case 'dismissed':
      return null;
    case 'failed':
      return 'Could not share — copy the link from the address bar';
  }
}
