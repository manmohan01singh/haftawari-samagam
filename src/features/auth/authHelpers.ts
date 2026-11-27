/**
 * Shared auth helpers: the email-link redirect target and human error
 * messages for the auth screens.
 *
 * Kept free of supabase imports so screens and context can use it
 * without import cycles.
 */

/** Base path the PWA is served under (app.json experiments.baseUrl). */
const WEB_BASE_PATH = '/haftawari-samagam';

/**
 * The URL confirmation / recovery email links must return to:
 * exactly the live PWA root, e.g.
 *   https://manmohan01singh.github.io/haftawari-samagam/
 *
 * It must be the base path itself and nothing deeper: GitHub Pages is
 * a static host with no SPA fallback, so a redirect to any deeper path
 * (…/auth/callback, …/sign-in) is a 404 on direct load — the email
 * link would dead-end before the app ever sees the tokens. The app
 * picks the session up from the URL at the base path instead
 * (detectSessionInUrl in src/lib/supabase.ts).
 *
 * Derived from the live origin so preview/local web builds point at
 * themselves; when the app is served from the domain root (no base
 * path in the current URL) the origin root is used. Returns undefined
 * on native, where no web redirect applies.
 */
export function authRedirectUrl(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined;
  const { origin, pathname } = window.location;
  if (pathname === WEB_BASE_PATH || pathname.startsWith(`${WEB_BASE_PATH}/`)) {
    return `${origin}${WEB_BASE_PATH}/`;
  }
  return `${origin}/`;
}

export type AuthErrorKind =
  | 'not_confirmed'
  | 'invalid_credentials'
  | 'already_registered'
  | 'rate_limit'
  | 'network'
  | 'weak_password'
  | 'oauth'
  | 'other';

export interface FriendlyAuthError {
  kind: AuthErrorKind;
  message: string;
}

/**
 * Map a Supabase auth error to a clear, human message for the form.
 * Raw GoTrue strings ("Invalid login credentials", …) left users
 * unable to tell a wrong password from an unconfirmed email from a
 * dead network — every failure looked like "login doesn't work".
 */
export function friendlyAuthError(error: unknown): FriendlyAuthError {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const msg = raw.toLowerCase();
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '').toLowerCase()
      : '';
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status ?? 0)
      : 0;

  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return {
      kind: 'not_confirmed',
      message:
        "Your email isn't confirmed yet. Tap the link in the confirmation email we sent you, then sign in. You can also resend the confirmation email below.",
    };
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return {
      kind: 'invalid_credentials',
      message:
        'Email or password is wrong. Check both and try again — or use "Forgot password?" to reset it.',
    };
  }
  if (code === 'user_already_exists' || msg.includes('already registered') || msg.includes('already exists')) {
    return {
      kind: 'already_registered',
      message:
        'An account with this email already exists. Try signing in instead — or reset your password if you have forgotten it.',
    };
  }
  if (
    status === 429 ||
    code.includes('rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('too many') ||
    msg.includes('you can only request this after') ||
    msg.includes('security purposes')
  ) {
    return {
      kind: 'rate_limit',
      message: 'Too many attempts in a short time. Please wait a minute and try again.',
    };
  }
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('networkerror') ||
    msg.includes('fetch failed') ||
    msg.includes('load failed')
  ) {
    return {
      kind: 'network',
      message: 'Could not reach the sign-in service. Check your internet connection and try again.',
    };
  }
  if (
    code.includes('provider') ||
    msg.includes('provider is not enabled') ||
    msg.includes('unsupported provider')
  ) {
    return {
      kind: 'oauth',
      message:
        'Google sign-in is not switched on yet. Please sign in with your email and password for now.',
    };
  }
  if (msg.includes('access_denied') || code.includes('access_denied')) {
    return {
      kind: 'oauth',
      message: 'Google sign-in was cancelled before it finished. Tap "Continue with Google" to try again.',
    };
  }
  if (code.includes('oauth') || msg.includes('oauth')) {
    return {
      kind: 'oauth',
      message: "Google sign-in didn't complete. Please try again.",
    };
  }
  if (msg.includes('password should be') || msg.includes('weak password') || code.includes('weak_password')) {
    return {
      kind: 'weak_password',
      message: 'That password is too short or too weak. Use at least 6 characters — longer is stronger.',
    };
  }
  if (msg.includes('invalid email') || msg.includes('unable to validate email')) {
    return {
      kind: 'other',
      message: 'That email address does not look valid. Check it and try again.',
    };
  }
  // Unknown error: show a generic line, never a raw GoTrue string and
  // never silence.
  return {
    kind: 'other',
    message: 'Something went wrong. Please try again — if it keeps happening, wait a bit and retry.',
  };
}

/**
 * Human message for a FAILED auth landing (expired / already used
 * email link, or a Google OAuth return that came back with an error),
 * from the URL snapshot taken in src/lib/supabase.ts. Returns null
 * when there was no landing error.
 *
 * OAuth failures are told apart from email-link failures by the raw
 * `error` param and the error code/description: GoTrue sends values
 * like error=access_denied (the user closed the Google picker) and
 * codes/descriptions mentioning "oauth" for provider-side failures.
 */
export function authLinkErrorMessage(
  error: string | null,
  errorCode: string | null,
  errorDescription: string | null,
): string | null {
  if (!error && !errorCode && !errorDescription) return null;
  const desc = (errorDescription ?? '').toLowerCase();
  const looksOAuth =
    (error ?? '').toLowerCase().includes('oauth') ||
    (errorCode ?? '').toLowerCase().includes('oauth') ||
    desc.includes('oauth');
  if (error === 'access_denied' && !desc.includes('expired')) {
    return 'Google sign-in was cancelled before it finished. Tap "Continue with Google" to try again.';
  }
  if (looksOAuth) {
    return "Google sign-in didn't complete — please try again. If it keeps happening, sign in with your email and password instead.";
  }
  if (errorCode === 'otp_expired' || desc.includes('expired')) {
    return 'That email link has expired or was already used. Sign in below — or request a fresh link with "Forgot password?" / resend.';
  }
  return 'That email link could not be used. Please try signing in, or request a fresh link.';
}
