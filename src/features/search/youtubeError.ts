/**
 * Classified YouTube Data API errors for the search leg.
 *
 * Pure module — no React Native imports — so it can be unit-verified
 * from plain Node.
 *
 * Why this exists (round-3 bug, 2026-11-27): a search for "Amritvela"
 * on the user's phone showed one generic banner ("channel results are
 * unavailable") and no results, with no trace of the real cause. Live
 * probing of the exact app requests showed the actual failure was
 * HTTP 429, reason `rateLimitExceeded`, on the 'Search Queries'
 * metric — search.list is rate-limited in bursts even though the
 * general quota pool (channels.list / playlistItems / videos.list,
 * 1 unit each) stays healthy, and the SAME call succeeds again about
 * a minute later. A single generic catch hid all of that and made a
 * transient, retryable failure look like a dead feature.
 *
 * The API key was also probed WITH the phone's Referer header
 * (https://manmohan01singh.github.io/haftawari-samagam/): every
 * endpoint returned 200 — there is NO referrer block on this key.
 * The `referrer` class below exists so that if Google Cloud key
 * restrictions ever change, the app names that cause instead of
 * collapsing it into the generic banner.
 */

export type YouTubeErrorClass =
  | 'quota' // daily quota exhausted (quotaExceeded) — hard stop until reset
  | 'rateLimit' // rateLimitExceeded — bursty throttling, recovers shortly
  | 'referrer' // API_KEY_HTTP_REFERRER_BLOCKED — key restriction config
  | 'config' // invalid key / API not enabled — dashboard-side config
  | 'network' // fetch itself failed (offline, DNS, connection reset)
  | 'timeout' // our own 10s abort
  | 'http' // other HTTP status (5xx is retryable, other 4xx is not)
  | 'unknown';

export class YouTubeApiError extends Error {
  readonly errorClass: YouTubeErrorClass;
  /** The API's machine-readable reason (error.errors[0].reason), if any. */
  readonly reason: string | null;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(init: {
    errorClass: YouTubeErrorClass;
    reason?: string | null;
    status?: number | null;
    retryable: boolean;
    message: string;
  }) {
    super(init.message);
    this.name = 'YouTubeApiError';
    this.errorClass = init.errorClass;
    this.reason = init.reason ?? null;
    this.status = init.status ?? null;
    this.retryable = init.retryable;
  }
}

interface GoogleErrorBody {
  error?: {
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
}

/** Build a classified error from an HTTP status + raw response body. */
export function parseYouTubeErrorBody(status: number, bodyText: string): YouTubeApiError {
  let reason: string | null = null;
  let message = `YouTube Data API request failed with HTTP ${status}.`;
  try {
    const parsed = JSON.parse(bodyText) as GoogleErrorBody;
    reason = parsed.error?.errors?.[0]?.reason ?? null;
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    // Non-JSON body (proxy error page etc.) — status alone classifies.
  }
  const haystack = `${reason ?? ''} ${message}`.toLowerCase();

  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new YouTubeApiError({ errorClass: 'quota', reason, status, retryable: false, message });
  }
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return new YouTubeApiError({ errorClass: 'rateLimit', reason, status, retryable: true, message });
  }
  if (haystack.includes('referer') || haystack.includes('referrer')) {
    return new YouTubeApiError({ errorClass: 'referrer', reason, status, retryable: false, message });
  }
  if (
    reason === 'keyInvalid' ||
    reason === 'apiKeyInvalid' ||
    reason === 'accessNotConfigured' ||
    haystack.includes('api key not valid')
  ) {
    return new YouTubeApiError({ errorClass: 'config', reason, status, retryable: false, message });
  }
  if (status >= 500) {
    return new YouTubeApiError({ errorClass: 'http', reason, status, retryable: true, message });
  }
  return new YouTubeApiError({ errorClass: 'http', reason, status, retryable: false, message });
}

/** Classify a fetch-level failure (no HTTP response was received). */
export function classifyFetchFailure(error: unknown): YouTubeApiError {
  if (error instanceof YouTubeApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  // TypeError is what fetch throws for offline / DNS / connection failures.
  return new YouTubeApiError({
    errorClass: 'network',
    retryable: true,
    message: message || 'Network request failed.',
  });
}

export function timeoutError(): YouTubeApiError {
  return new YouTubeApiError({
    errorClass: 'timeout',
    retryable: true,
    message: 'YouTube Data API request timed out.',
  });
}

/**
 * Human banner text per error class. The banner may ONLY be shown with
 * one of these after a real, classified failure of the channel leg.
 */
export function degradedBannerText(errorClass: YouTubeErrorClass | null): string {
  switch (errorClass) {
    case 'quota':
      return 'Channel search has hit its daily limit — showing the published archive only. Try again later.';
    case 'rateLimit':
      return 'Channel search is being rate-limited right now — showing the published archive only. Tap Retry in a moment.';
    case 'referrer':
    case 'config':
      return 'Channel search is misconfigured right now — showing the published archive only.';
    case 'network':
      return 'Network problem — channel results could not be loaded. Showing the published archive only.';
    case 'timeout':
      return 'Channel search timed out — showing the published archive only.';
    case 'http':
    case 'unknown':
    default:
      return 'Showing the published archive only — channel results are unavailable right now.';
  }
}
