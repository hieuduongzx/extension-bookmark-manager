/**
 * Shared Google Drive sync module — OAuth via chrome.identity.launchWebAuthFlow.
 *
 * Uses a Google OAuth client of type **Web application** with the redirect URI
 * `https://<extension-id>.chromiumapp.org/`. Works on Chrome, Edge, Brave, Opera, Vivaldi.
 * (chrome.identity.getAuthToken is intentionally not used: it needs a separate
 * "Chrome Extension" client and does not work outside Google Chrome.)
 *
 * Implicit flow (response_type=token): tokens live ~1h; refresh silently with prompt=none,
 * which needs an active Google session in the browser. When that fails we surface
 * `needs_reauth` so the UI can offer "Sign in again".
 */
import { DriveSyncError, type DriveErrorCode } from './types.ts';

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export interface AuthConfig {
  clientId: string;
  scopes: string[];
  /** chrome.storage.local key for the cached token */
  tokenStorageKey: string;
}

export interface StoredToken {
  accessToken: string;
  /** Epoch ms after which the token must not be used (already includes a safety margin) */
  expiresAt: number;
}

/** Refresh this long before Google's stated expiry. */
const EXPIRY_SKEW_MS = 90_000;

export function isClientIdConfigured(clientId: string | undefined | null): boolean {
  const id = (clientId || '').trim();
  if (!id) return false;
  if (id.includes('YOUR_') || id.includes('your-client-id') || id.includes('PLACEHOLDER')) return false;
  return id.endsWith('.apps.googleusercontent.com');
}

export function getRedirectUri(): string {
  try {
    return chrome.identity.getRedirectURL();
  } catch {
    return `https://${chrome.runtime.id}.chromiumapp.org/`;
  }
}

export function buildAuthUrl(cfg: AuthConfig, interactive: boolean, redirectUri: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', cfg.scopes.join(' '));
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', interactive ? 'select_account' : 'none');
  return url.toString();
}

export function parseTokenFromRedirectUrl(responseUrl: string): {
  accessToken: string;
  expiresInSec: number;
} {
  const hash = responseUrl.includes('#') ? responseUrl.slice(responseUrl.indexOf('#') + 1) : '';
  const query = responseUrl.includes('?') ? responseUrl.split('?')[1]?.split('#')[0] ?? '' : '';
  const params = new URLSearchParams(hash || query);
  const error = params.get('error');
  if (error) {
    const desc = params.get('error_description');
    throw new Error(desc ? `${error}: ${desc}` : error);
  }
  const accessToken = params.get('access_token');
  if (!accessToken) {
    throw new Error('No access_token in OAuth redirect. Check client type + redirect URI.');
  }
  const expiresInSec = Number(params.get('expires_in') || '3600');
  return {
    accessToken,
    expiresInSec: Number.isFinite(expiresInSec) && expiresInSec > 0 ? expiresInSec : 3600,
  };
}

/** Map a raw chrome.identity / OAuth error message to a stable code. */
export function classifyAuthError(raw: string, interactive: boolean): DriveErrorCode {
  const lower = (raw || '').toLowerCase();
  if (lower.includes('redirect_uri_mismatch') || lower.includes('redirect uri')) {
    return 'redirect_uri_mismatch';
  }
  if (lower.includes('bad client id') || lower.includes('invalid_client') || lower.includes('unauthorized_client')) {
    return 'invalid_client';
  }
  if (
    lower.includes('access_denied') ||
    lower.includes('not approved') ||
    lower.includes('has not completed')
  ) {
    return interactive ? 'access_denied' : 'needs_reauth';
  }
  if (lower.includes('oauth2') && lower.includes('disabled')) return 'oauth_disabled';
  if (lower.includes('must be called') || lower.includes('user gesture')) return 'user_gesture';
  if (
    lower.includes('interaction_required') ||
    lower.includes('login_required') ||
    lower.includes('consent_required') ||
    lower.includes('account_selection_required') ||
    lower.includes('user interaction required') ||
    lower.includes('could not be loaded')
  ) {
    return interactive ? 'cancelled' : 'needs_reauth';
  }
  if (
    lower.includes('did not approve') ||
    lower.includes('canceled') ||
    lower.includes('cancelled') ||
    lower.includes('user closed')
  ) {
    return interactive ? 'cancelled' : 'needs_reauth';
  }
  return interactive ? 'auth_failed' : 'needs_reauth';
}

async function loadToken(cfg: AuthConfig): Promise<StoredToken | null> {
  const res = await chrome.storage.local.get(cfg.tokenStorageKey);
  const raw = res[cfg.tokenStorageKey] as Partial<StoredToken> | undefined;
  if (!raw || typeof raw.accessToken !== 'string' || !raw.accessToken) return null;
  if (typeof raw.expiresAt !== 'number') return null;
  return { accessToken: raw.accessToken, expiresAt: raw.expiresAt };
}

async function saveToken(cfg: AuthConfig, token: StoredToken | null): Promise<void> {
  if (token) await chrome.storage.local.set({ [cfg.tokenStorageKey]: token });
  else await chrome.storage.local.remove(cfg.tokenStorageKey);
}

function launchWebAuthFlow(url: string, interactive: boolean): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const details: chrome.identity.WebAuthFlowDetails & {
      abortOnLoadForNonInteractive?: boolean;
      timeoutMsForNonInteractive?: number;
    } = { url, interactive };
    if (!interactive) {
      // Chrome 113+: let the silent page finish its redirects instead of aborting on first load.
      details.abortOnLoadForNonInteractive = false;
      details.timeoutMsForNonInteractive = 10_000;
    }
    try {
      chrome.identity.launchWebAuthFlow(details, (callbackUrl) => {
        const err = chrome.runtime.lastError;
        if (err?.message) reject(new Error(err.message));
        else resolve(callbackUrl);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Get a usable access token.
 * - cached and not expired → returned as is (unless forceRefresh)
 * - interactive → account chooser (prompt=select_account)
 * - silent → prompt=none; failure → DriveSyncError('needs_reauth')
 */
export async function getAccessToken(
  cfg: AuthConfig,
  opts: { interactive: boolean; forceRefresh?: boolean }
): Promise<StoredToken> {
  if (!isClientIdConfigured(cfg.clientId)) {
    throw new DriveSyncError('not_configured', 'Google OAuth client ID is not configured.');
  }
  if (!opts.forceRefresh) {
    const cached = await loadToken(cfg);
    if (cached && cached.expiresAt > Date.now()) return cached;
  }

  const redirectUri = getRedirectUri();
  let responseUrl: string | undefined;
  try {
    responseUrl = await launchWebAuthFlow(buildAuthUrl(cfg, opts.interactive, redirectUri), opts.interactive);
    if (!responseUrl) throw new Error(opts.interactive ? 'The user closed the sign-in window.' : 'interaction_required');
    const { accessToken, expiresInSec } = parseTokenFromRedirectUrl(responseUrl);
    const token: StoredToken = {
      accessToken,
      expiresAt: Date.now() + expiresInSec * 1000 - EXPIRY_SKEW_MS,
    };
    await saveToken(cfg, token);
    return token;
  } catch (err) {
    if (err instanceof DriveSyncError) throw err;
    const raw = err instanceof Error ? err.message : String(err);
    const code = classifyAuthError(raw, opts.interactive);
    throw new DriveSyncError(code, raw, { detail: raw });
  }
}

/** Revoke (best effort) and forget the cached token. Skips revoke for expired tokens. */
export async function revokeToken(cfg: AuthConfig): Promise<void> {
  const cached = await loadToken(cfg);
  if (cached && cached.expiresAt > Date.now()) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cached.accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      // best effort
    }
  }
  await saveToken(cfg, null);
}

export async function forgetToken(cfg: AuthConfig): Promise<void> {
  await saveToken(cfg, null);
}
