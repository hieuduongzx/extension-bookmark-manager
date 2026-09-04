/**
 * Google Drive App Data sync for Bookmark Manager.
 *
 * Auth (cross-browser):
 * - Chrome: chrome.identity.getAuthToken when available
 * - Edge / others: chrome.identity.launchWebAuthFlow (getAuthToken is NOT supported on Edge)
 *
 * For Edge you need a Google OAuth client type **Web application** with redirect URI:
 *   https://<extension-id>.chromiumapp.org/
 * (Chrome-Extension-type clients only work with getAuthToken on Google Chrome.)
 *
 * Storage: hidden Drive appDataFolder file — not visible in the user's Drive UI.
 */

import type { AppSettings, Bookmark, Collection } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  canonicalizeUrlForMatch,
  getFavicon,
  getDomain,
  isSafeBookmarkUrl,
  sanitizeBookmarkUrl,
} from './utils';
import {
  EMPTY_TOMBSTONES,
  loadTombstones,
  pruneTombstones,
  saveTombstones,
  type Tombstones,
} from './storage';

export const GDRIVE_SYNC_FILENAME = 'bookmark-manager-sync.json';
export const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const GDRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;
export const GDRIVE_ALARM = 'bm-gdrive-auto-sync';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'bm_gdrive_token';
/** Refresh a bit early so API calls rarely hit 401 mid-flight */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

export interface GDriveSyncPayload {
  version: 1;
  exportedAt: number;
  bookmarks: Bookmark[];
  collections: Collection[];
  /** Safe subset of settings (no secrets) */
  settings?: Partial<AppSettings>;
  /** id → deletedAt so deletions propagate instead of resurrecting on the next sync */
  deletedBookmarks?: Record<string, number>;
  deletedCollections?: Record<string, number>;
}

export interface GDriveStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastSyncAt: number | null;
  autoSync: boolean;
  fileId: string | null;
  lastError: string | null;
  /** Current unpacked/packed extension id */
  extensionId: string;
  /** OAuth redirect for launchWebAuthFlow (Edge + Web application client) */
  redirectUri: string;
  /** true when running on Microsoft Edge (getAuthToken unsupported) */
  isEdge: boolean;
}

/** Lightweight status for popup / sidebar chrome */
export interface GDriveUiStatus {
  connected: boolean;
  email: string | null;
  lastSyncAt: number | null;
  busy?: boolean;
}

interface StoredAccessToken {
  accessToken: string;
  expiresAt: number;
  source: 'getAuthToken' | 'webAuthFlow';
}

export interface GDriveSyncResult {
  ok: boolean;
  lastSyncAt: number;
  bookmarkCount: number;
  collectionCount: number;
  error?: string;
}

export interface GDriveAuthMeta {
  connected: boolean;
  email: string | null;
  fileId: string | null;
  lastSyncAt: number | null;
  autoSync: boolean;
  lastError: string | null;
}

export const DEFAULT_GDRIVE_META: GDriveAuthMeta = {
  connected: false,
  email: null,
  fileId: null,
  lastSyncAt: null,
  autoSync: true,
  lastError: null,
};

const META_KEY = 'bm_gdrive_meta';

export async function loadGDriveMeta(): Promise<GDriveAuthMeta> {
  const result = await chrome.storage.local.get(META_KEY);
  const raw = result[META_KEY] as Partial<GDriveAuthMeta> | undefined;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GDRIVE_META };
  return { ...DEFAULT_GDRIVE_META, ...raw };
}

export async function saveGDriveMeta(patch: Partial<GDriveAuthMeta>): Promise<GDriveAuthMeta> {
  const current = await loadGDriveMeta();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [META_KEY]: next });
  return next;
}

/** True when manifest oauth2.client_id looks like a real Google client id. */
export function isGDriveConfigured(): boolean {
  const id = getOAuthClientId();
  if (!id) return false;
  if (id.includes('YOUR_') || id.includes('PLACEHOLDER') || id.startsWith('000000')) {
    return false;
  }
  return id.endsWith('.apps.googleusercontent.com');
}

export function getOAuthClientId(): string {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & {
    oauth2?: { client_id?: string };
  };
  return manifest.oauth2?.client_id?.trim() ?? '';
}

export function getOAuthRedirectUri(): string {
  try {
    return chrome.identity.getRedirectURL();
  } catch {
    return `https://${chrome.runtime.id}.chromiumapp.org/`;
  }
}

export function isEdgeBrowser(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /\bEdg\//.test(ua);
}

/**
 * We use a Google OAuth client of type **Web application**, which is incompatible
 * with chrome.identity.getAuthToken (that path requires a Chrome-Extension client
 * and a custom-scheme redirect). Always go through launchWebAuthFlow instead so the
 * same Web client works on Chrome, Edge and other Chromium browsers.
 */
function supportsGetAuthToken(): boolean {
  return false;
}

async function loadStoredToken(): Promise<StoredAccessToken | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  const raw = result[TOKEN_KEY] as StoredAccessToken | undefined;
  if (!raw?.accessToken || typeof raw.expiresAt !== 'number') return null;
  return raw;
}

async function saveStoredToken(token: StoredAccessToken): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

async function clearStoredToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

function mapAuthError(raw: string): string {
  const msg = (raw || '').trim();
  const lower = msg.toLowerCase();
  const redirectUri = getOAuthRedirectUri();
  const extId = chrome.runtime.id;

  if (!msg) {
    return 'Google sign-in failed (empty error). Try Connect again from the full Dashboard tab.';
  }
  if (lower.includes('not supported') && (lower.includes('edge') || lower.includes('microsoft'))) {
    return (
      'Edge không hỗ trợ getAuthToken — đã chuyển sang launchWebAuthFlow.\n' +
      'Nếu vẫn lỗi: tạo OAuth client loại **Web application** và thêm Redirect URI:\n' +
      redirectUri
    );
  }
  if (lower.includes('redirect_uri_mismatch') || lower.includes('redirect uri')) {
    return (
      `redirect_uri_mismatch — Redirect URI chưa được đăng ký.\n` +
      `→ Google Cloud → Credentials → OAuth client (**Web application**)\n` +
      `→ Authorized redirect URIs → thêm đúng:\n${redirectUri}\n` +
      `(Extension ID: ${extId})`
    );
  }
  if (lower.includes('bad client id') || lower.includes('invalid_client')) {
    return (
      `OAuth Client ID không hợp lệ hoặc sai loại.\n` +
      `• Chrome: client type Chrome Extension + Item ID = ${extId}\n` +
      `• Edge: client type **Web application** + redirect URI =\n${redirectUri}`
    );
  }
  if (lower.includes('access_denied') || lower.includes('not approved') || lower.includes('has not completed')) {
    return (
      'Google chặn đăng nhập (app đang Testing hoặc chưa thêm test user).\n' +
      '→ OAuth consent screen → Test users → thêm đúng email Google của bạn.'
    );
  }
  if (lower.includes('oauth2') && lower.includes('disabled')) {
    return 'OAuth bị tắt cho client này. Kiểm tra OAuth consent screen / Client ID trong Google Cloud.';
  }
  if (
    lower.includes('user interaction required') ||
    lower.includes('the user did not approve') ||
    lower.includes('canceled') ||
    lower.includes('cancelled') ||
    lower.includes('the user closed')
  ) {
    return 'Bạn đã hủy đăng nhập Google, hoặc cửa sổ đăng nhập bị chặn. Hãy bấm Connect lại và cho phép quyền.';
  }
  if (lower.includes('must be called') || lower.includes('user gesture')) {
    return 'Cần thao tác trực tiếp từ người dùng. Mở Dashboard (tab đầy đủ) → Settings → Connect.';
  }
  return msg;
}

function mapDriveHttpError(status: number, body: string): string {
  const text = body.slice(0, 400);
  const lower = text.toLowerCase();

  if (status === 403 && (lower.includes('accessnotconfigured') || lower.includes('has not been used') || lower.includes('disabled'))) {
    return (
      'Google Drive API chưa bật cho project.\n' +
      '→ Google Cloud → APIs & Services → Library → bật “Google Drive API”, đợi ~1 phút rồi thử lại.'
    );
  }
  if (status === 403 && (lower.includes('insufficient') || lower.includes('access_denied'))) {
    return (
      'Token không đủ quyền Drive App Data. Disconnect → Connect lại và chấp nhận toàn bộ quyền.\n' +
      `(${status}) ${text}`
    );
  }
  if (status === 401) {
    return `Token hết hạn hoặc không hợp lệ (401). Disconnect rồi Connect lại.\n${text}`;
  }
  return `Drive API error (${status}): ${text || 'no body'}`;
}

function getAuthTokenChrome(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.getAuthToken({ interactive }, (result) => {
        const lastError = chrome.runtime.lastError;
        if (lastError?.message) {
          reject(new Error(lastError.message));
          return;
        }

        const token =
          typeof result === 'string'
            ? result
            : result && typeof result === 'object' && 'token' in result
              ? String((result as { token?: string }).token || '')
              : '';

        if (!token) {
          reject(new Error(interactive ? 'No auth token returned' : 'Silent auth failed'));
          return;
        }
        resolve(token);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function parseTokenFromRedirectUrl(responseUrl: string): { accessToken: string; expiresIn: number } {
  // Implicit flow returns tokens in the URL hash; some providers use query.
  const hash = responseUrl.includes('#') ? responseUrl.split('#')[1] : '';
  const query = responseUrl.includes('?') ? responseUrl.split('?')[1]?.split('#')[0] : '';
  const params = new URLSearchParams(hash || query || '');

  const error = params.get('error');
  if (error) {
    const desc = params.get('error_description') || error;
    throw new Error(desc);
  }

  const accessToken = params.get('access_token');
  if (!accessToken) {
    throw new Error('No access_token in OAuth redirect. Check client type + redirect URI.');
  }
  const expiresIn = Number(params.get('expires_in') || 3600);
  return { accessToken, expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600 };
}

/**
 * Cross-browser OAuth via launchWebAuthFlow (required on Microsoft Edge).
 * Needs Google OAuth client type "Web application" with redirect URI = getRedirectURL().
 */
async function getTokenViaWebAuthFlow(interactive: boolean): Promise<string> {
  const clientId = getOAuthClientId();
  const redirectUri = getOAuthRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: GDRIVE_SCOPES.join(' '),
    include_granted_scopes: 'true',
  });
  if (!interactive) {
    params.set('prompt', 'none');
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  let responseUrl: string | undefined;
  try {
    responseUrl = await new Promise<string | undefined>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (url) => {
        const err = chrome.runtime.lastError;
        if (err?.message) {
          reject(new Error(err.message));
          return;
        }
        resolve(url);
      });
    });
  } catch (err) {
    throw new Error(mapAuthError(err instanceof Error ? err.message : String(err)));
  }

  if (!responseUrl) {
    throw new Error(
      interactive
        ? 'Đăng nhập bị hủy hoặc không nhận được redirect.'
        : 'Phiên Google hết hạn. Bấm Connect / Sync now để đăng nhập lại.'
    );
  }

  const { accessToken, expiresIn } = parseTokenFromRedirectUrl(responseUrl);
  await saveStoredToken({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    source: 'webAuthFlow',
  });
  return accessToken;
}

/**
 * Returns a valid Google access token.
 * Chrome: prefer getAuthToken; Edge / fallback: launchWebAuthFlow + local cache.
 */
export async function getAccessToken(interactive: boolean): Promise<string> {
  if (!isGDriveConfigured()) {
    throw new Error(
      'Google Drive OAuth is not configured. Set VITE_GOOGLE_CLIENT_ID and rebuild (see README).'
    );
  }

  const cached = await loadStoredToken();
  if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return cached.accessToken;
  }

  // Edge and non-Chrome: only web auth flow
  if (!supportsGetAuthToken()) {
    return getTokenViaWebAuthFlow(interactive);
  }

  try {
    const token = await getAuthTokenChrome(interactive);
    // Chrome caches tokens; keep a long local expiry for our 401 retry path
    await saveStoredToken({
      accessToken: token,
      expiresAt: Date.now() + 50 * 60 * 1000,
      source: 'getAuthToken',
    });
    return token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    // Fall back when getAuthToken is missing / blocked (Brave, Edge UA spoof, etc.)
    if (
      lower.includes('not supported') ||
      lower.includes('is not available') ||
      lower.includes('undefined')
    ) {
      return getTokenViaWebAuthFlow(interactive);
    }
    throw new Error(mapAuthError(msg));
  }
}

export async function revokeAccessToken(token?: string): Promise<void> {
  const stored = await loadStoredToken();
  const toRevoke = token || stored?.accessToken;

  try {
    if (toRevoke && stored?.source === 'getAuthToken' && chrome.identity.removeCachedAuthToken) {
      await new Promise<void>((resolve) => {
        try {
          chrome.identity.removeCachedAuthToken({ token: toRevoke }, () => resolve());
        } catch {
          resolve();
        }
      });
    }
    if (toRevoke) {
      try {
        await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(toRevoke)}`, {
          method: 'POST',
        });
      } catch {
        // ignore
      }
    }
    if (chrome.identity.clearAllCachedAuthTokens) {
      await new Promise<void>((resolve) => {
        try {
          chrome.identity.clearAllCachedAuthTokens(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  } catch {
    // best-effort
  } finally {
    await clearStoredToken();
  }
}

async function driveFetch(
  token: string,
  url: string,
  init: RequestInit = {},
  retried = false
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });

  if (res.status === 401 && !retried) {
    await revokeAccessToken(token);
    const fresh = await getAccessToken(false);
    return driveFetch(fresh, url, init, true);
  }

  return res;
}

async function fetchUserEmail(token: string): Promise<string | null> {
  try {
    const res = await driveFetch(
      token,
      'https://www.googleapis.com/oauth2/v2/userinfo'
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

async function findSyncFileId(token: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${GDRIVE_SYNC_FILENAME}' and trashed=false`);
  const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)&pageSize=10`;
  const res = await driveFetch(token, url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(mapDriveHttpError(res.status, text));
  }
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function downloadSyncFile(token: string, fileId: string): Promise<GDriveSyncPayload | null> {
  const res = await driveFetch(token, `${DRIVE_API}/files/${fileId}?alt=media`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(mapDriveHttpError(res.status, text));
  }
  const data = (await res.json()) as GDriveSyncPayload;
  if (!data || data.version !== 1 || !Array.isArray(data.bookmarks)) {
    throw new Error('Invalid sync file format on Google Drive');
  }
  return data;
}

async function uploadSyncFile(
  token: string,
  payload: GDriveSyncPayload,
  fileId: string | null
): Promise<string> {
  const body = JSON.stringify(payload);

  if (fileId) {
    const res = await driveFetch(token, `${DRIVE_UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // File may have been deleted — create a new one
      if (res.status === 404) {
        return uploadSyncFile(token, payload, null);
      }
      throw new Error(mapDriveHttpError(res.status, text));
    }
    const data = (await res.json()) as { id: string };
    return data.id || fileId;
  }

  const metadata = {
    name: GDRIVE_SYNC_FILENAME,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
  };
  const boundary = 'bm_sync_boundary_' + Date.now();
  const multipart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${body}\r\n` +
    `--${boundary}--`;

  const res = await driveFetch(token, `${DRIVE_UPLOAD}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(mapDriveHttpError(res.status, text));
  }
  const data = (await res.json()) as { id: string };
  if (!data.id) throw new Error('Drive create returned no file id');
  return data.id;
}

function normalizeTags(tags: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function sanitizeBookmark(bookmark: Bookmark): Bookmark | null {
  const safeUrl = sanitizeBookmarkUrl(bookmark?.url || '');
  if (!safeUrl || typeof bookmark?.id !== 'string') return null;
  return {
    ...bookmark,
    url: safeUrl,
    title: typeof bookmark.title === 'string' ? bookmark.title : getDomain(safeUrl),
    favicon: typeof bookmark.favicon === 'string' ? bookmark.favicon : getFavicon(safeUrl),
    tags: normalizeTags(bookmark.tags),
    note: typeof bookmark.note === 'string' ? bookmark.note : undefined,
    collectionId:
      typeof bookmark.collectionId === 'string' ? bookmark.collectionId : '__unsorted__',
    createdAt: typeof bookmark.createdAt === 'number' ? bookmark.createdAt : Date.now(),
    updatedAt: typeof bookmark.updatedAt === 'number' ? bookmark.updatedAt : Date.now(),
    pinned: Boolean(bookmark.pinned),
    coverUrl:
      typeof bookmark.coverUrl === 'string' && isSafeBookmarkUrl(bookmark.coverUrl)
        ? bookmark.coverUrl
        : undefined,
    previousCollectionId:
      typeof bookmark.previousCollectionId === 'string'
        ? bookmark.previousCollectionId
        : undefined,
    linkStatus: typeof bookmark.linkStatus === 'number' ? bookmark.linkStatus : undefined,
    lastCheckedAt: typeof bookmark.lastCheckedAt === 'number' ? bookmark.lastCheckedAt : undefined,
    order: typeof bookmark.order === 'number' ? bookmark.order : undefined,
  };
}

export function sanitizeCollection(collection: Collection): Collection | null {
  if (!collection || typeof collection.id !== 'string' || typeof collection.name !== 'string') {
    return null;
  }
  return {
    ...collection,
    parentId: typeof collection.parentId === 'string' ? collection.parentId : undefined,
    pinned: Boolean(collection.pinned),
    createdAt: typeof collection.createdAt === 'number' ? collection.createdAt : Date.now(),
    updatedAt:
      typeof collection.updatedAt === 'number'
        ? collection.updatedAt
        : typeof collection.createdAt === 'number'
          ? collection.createdAt
          : Date.now(),
  };
}

/** Combine two id→deletedAt maps, keeping the newest timestamp per id. */
function mergeTombstoneRecords(
  a: Record<string, number> = {},
  b: Record<string, number> = {}
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [id, ts] of Object.entries(b)) {
    out[id] = Math.max(out[id] ?? 0, ts);
  }
  return out;
}

/** Merge two bookmarks that share a canonical URL — keep newer, but don't lose tags/note/cover. */
function mergeDuplicateBookmarks(keep: Bookmark, drop: Bookmark): Bookmark {
  const [newer, older] = keep.updatedAt >= drop.updatedAt ? [keep, drop] : [drop, keep];
  return {
    ...newer,
    tags: Array.from(new Set([...newer.tags, ...older.tags])),
    note: newer.note ?? older.note,
    coverUrl: newer.coverUrl ?? older.coverUrl,
  };
}

/**
 * Merge local + remote. Per-entity last-write-wins by updatedAt.
 * Entities only on one side are kept (union). Deletions are represented by tombstones
 * (id → deletedAt): an entity is dropped when a tombstone is newer than its updatedAt,
 * so a delete on one device doesn't get resurrected by the other device's stale copy.
 */
export function mergeSyncData(
  localBookmarks: Bookmark[],
  localCollections: Collection[],
  remote: GDriveSyncPayload | null,
  localTombstones: Tombstones = EMPTY_TOMBSTONES
): { bookmarks: Bookmark[]; collections: Collection[]; tombstones: Tombstones } {
  const remoteBookmarks = (remote?.bookmarks || [])
    .map((b) => sanitizeBookmark(b))
    .filter((b): b is Bookmark => !!b);
  const remoteCollections = (remote?.collections || [])
    .map((c) => sanitizeCollection(c))
    .filter((c): c is Collection => !!c);

  const localB = localBookmarks
    .map((b) => sanitizeBookmark(b))
    .filter((b): b is Bookmark => !!b);
  const localC = localCollections
    .map((c) => sanitizeCollection(c))
    .filter((c): c is Collection => !!c);

  // Union of every tombstone either side knows about.
  const bookmarkTombstones = mergeTombstoneRecords(
    localTombstones.bookmarks,
    remote?.deletedBookmarks
  );
  const collectionTombstones = mergeTombstoneRecords(
    localTombstones.collections,
    remote?.deletedCollections
  );

  // Collections by id (LWW)
  const colMap = new Map<string, Collection>();
  for (const c of localC) colMap.set(c.id, c);
  for (const c of remoteCollections) {
    const existing = colMap.get(c.id);
    if (!existing) {
      colMap.set(c.id, c);
    } else {
      const localTs = existing.updatedAt ?? existing.createdAt ?? 0;
      const remoteTs = c.updatedAt ?? c.createdAt ?? 0;
      colMap.set(c.id, remoteTs >= localTs ? c : existing);
    }
  }

  // Bookmarks by id (LWW)
  const bmMap = new Map<string, Bookmark>();
  for (const b of localB) bmMap.set(b.id, b);
  for (const b of remoteBookmarks) {
    const existing = bmMap.get(b.id);
    if (!existing) {
      bmMap.set(b.id, b);
    } else {
      bmMap.set(b.id, b.updatedAt >= existing.updatedAt ? b : existing);
    }
  }

  // Apply tombstones: a deletion wins unless the entity was edited after it was deleted.
  // When the entity survives (edited later), the stale tombstone is dropped so it can't
  // kill the revived entity on a future sync.
  for (const [id, deletedAt] of Object.entries(bookmarkTombstones)) {
    const b = bmMap.get(id);
    if (!b) continue;
    if (deletedAt >= b.updatedAt) bmMap.delete(id);
    else delete bookmarkTombstones[id];
  }
  for (const [id, deletedAt] of Object.entries(collectionTombstones)) {
    const c = colMap.get(id);
    if (!c) continue;
    const ts = c.updatedAt ?? c.createdAt ?? 0;
    if (deletedAt >= ts) colMap.delete(id);
    else delete collectionTombstones[id];
  }

  // Collapse duplicate URLs (different ids) using the same canonical key the app uses,
  // merging fields so tags/notes/covers survive rather than being silently dropped.
  const byUrl = new Map<string, Bookmark>();
  for (const b of bmMap.values()) {
    const key = canonicalizeUrlForMatch(b.url);
    const existing = byUrl.get(key);
    byUrl.set(key, existing ? mergeDuplicateBookmarks(existing, b) : b);
  }

  return {
    bookmarks: Array.from(byUrl.values()),
    collections: Array.from(colMap.values()),
    tombstones: pruneTombstones({
      bookmarks: bookmarkTombstones,
      collections: collectionTombstones,
    }),
  };
}

export function buildSyncPayload(
  bookmarks: Bookmark[],
  collections: Collection[],
  settings: AppSettings,
  tombstones: Tombstones = EMPTY_TOMBSTONES
): GDriveSyncPayload {
  // Settings that are safe / useful to roam; skip device-specific prefs if needed
  const settingsPatch: Partial<AppSettings> = {
    theme: settings.theme,
    locale: settings.locale,
    defaultCollectionId: settings.defaultCollectionId,
    defaultSort: settings.defaultSort,
    defaultViewMode: settings.defaultViewMode,
    fetchPreviews: settings.fetchPreviews,
    trashAutoEmptyDays: settings.trashAutoEmptyDays,
    showQuickSave: settings.showQuickSave,
    openInSidePanel: settings.openInSidePanel,
    gdriveAutoSync: settings.gdriveAutoSync,
  };

  return {
    version: 1,
    exportedAt: Date.now(),
    bookmarks,
    collections,
    settings: settingsPatch,
    deletedBookmarks: tombstones.bookmarks,
    deletedCollections: tombstones.collections,
  };
}

export async function connectGDrive(): Promise<GDriveAuthMeta> {
  const token = await getAccessToken(true);
  const email = await fetchUserEmail(token);
  let fileId = await findSyncFileId(token);
  const meta = await saveGDriveMeta({
    connected: true,
    email,
    fileId,
    lastError: null,
  });
  return meta;
}

export async function disconnectGDrive(): Promise<GDriveAuthMeta> {
  try {
    const token = await getAccessToken(false).catch(() => undefined);
    await revokeAccessToken(token);
  } catch {
    await revokeAccessToken();
  }
  return saveGDriveMeta({
    connected: false,
    email: null,
    fileId: null,
    lastError: null,
  });
}

export async function getGDriveStatus(): Promise<GDriveStatus> {
  const meta = await loadGDriveMeta();
  return {
    configured: isGDriveConfigured(),
    connected: meta.connected,
    email: meta.email,
    lastSyncAt: meta.lastSyncAt,
    autoSync: meta.autoSync,
    fileId: meta.fileId,
    lastError: meta.lastError,
    extensionId: chrome.runtime.id,
    redirectUri: getOAuthRedirectUri(),
    isEdge: isEdgeBrowser(),
  };
}

interface SyncOutcome {
  result: GDriveSyncResult;
  bookmarks: Bookmark[];
  collections: Collection[];
  settings: AppSettings;
  meta: GDriveAuthMeta;
}

type SyncLocal = { bookmarks: Bookmark[]; collections: Collection[]; settings: AppSettings };

/**
 * Serializes sync runs so the alarm, startup pull and a manual sync can't overlap.
 * Overlap otherwise races uploads (losing merges) and, on first sync, makes two callers
 * both see `fileId === null` and each create a duplicate appDataFolder file.
 */
let syncChain: Promise<SyncOutcome> = Promise.resolve() as unknown as Promise<SyncOutcome>;

export function syncWithGoogleDrive(
  local: SyncLocal,
  options: { interactive?: boolean } = {}
): Promise<SyncOutcome> {
  const run = () => runSyncWithGoogleDrive(local, options);
  const next = syncChain.then(run, run);
  // Swallow rejection on the chain handle so one failure doesn't poison the queue.
  syncChain = next.catch(() => undefined) as Promise<SyncOutcome>;
  return next;
}

/**
 * Pull remote → merge with local (honoring tombstones) → push merged result.
 * @param interactive When false (alarms / startup), never show a sign-in popup.
 */
async function runSyncWithGoogleDrive(
  local: SyncLocal,
  options: { interactive?: boolean } = {}
): Promise<SyncOutcome> {
  const interactive = options.interactive !== false;
  try {
    const token = await getAccessToken(interactive);
    let meta = await loadGDriveMeta();
    if (!meta.connected) {
      const email = await fetchUserEmail(token);
      meta = await saveGDriveMeta({ connected: true, email, lastError: null });
    }

    let fileId = meta.fileId || (await findSyncFileId(token));
    const remote = fileId ? await downloadSyncFile(token, fileId) : null;

    const localTombstones = await loadTombstones();
    const merged = mergeSyncData(local.bookmarks, local.collections, remote, localTombstones);

    let nextSettings = { ...local.settings };
    if (remote?.settings && typeof remote.settings === 'object') {
      // Prefer local settings for device UX, but fill missing keys from remote
      nextSettings = {
        ...DEFAULT_SETTINGS,
        ...remote.settings,
        ...local.settings,
        gdriveAutoSync:
          local.settings.gdriveAutoSync ??
          remote.settings.gdriveAutoSync ??
          DEFAULT_SETTINGS.gdriveAutoSync,
      };
    }

    const payload = buildSyncPayload(
      merged.bookmarks,
      merged.collections,
      nextSettings,
      merged.tombstones
    );
    fileId = await uploadSyncFile(token, payload, fileId);

    // Persist the reconciled tombstone set (stale entries pruned by mergeSyncData).
    await saveTombstones(merged.tombstones);

    const now = Date.now();
    meta = await saveGDriveMeta({
      connected: true,
      fileId,
      lastSyncAt: now,
      lastError: null,
      autoSync: nextSettings.gdriveAutoSync !== false,
    });

    return {
      result: {
        ok: true,
        lastSyncAt: now,
        bookmarkCount: merged.bookmarks.length,
        collectionCount: merged.collections.length,
      },
      bookmarks: merged.bookmarks,
      collections: merged.collections,
      settings: nextSettings,
      meta,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const meta = await saveGDriveMeta({ lastError: message });
    return {
      result: {
        ok: false,
        lastSyncAt: meta.lastSyncAt ?? 0,
        bookmarkCount: local.bookmarks.length,
        collectionCount: local.collections.length,
        error: message,
      },
      bookmarks: local.bookmarks,
      collections: local.collections,
      settings: local.settings,
      meta,
    };
  }
}

export async function ensureGDriveAlarm(enabled: boolean): Promise<void> {
  try {
    await chrome.alarms.clear(GDRIVE_ALARM);
    if (enabled) {
      // Every 30 minutes while browser is running
      await chrome.alarms.create(GDRIVE_ALARM, { periodInMinutes: 30 });
    }
  } catch {
    // alarms permission missing or unavailable
  }
}
