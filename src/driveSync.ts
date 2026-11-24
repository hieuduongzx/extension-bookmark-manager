/**
 * Bookmark Manager wiring for the shared Google Drive sync module (`src/shared/driveSync`).
 * Background (service worker) only — UI code may import *types* from here.
 */
import {
  DRIVE_APPDATA_SCOPE,
  forgetToken,
  getAccessToken,
  getRedirectUri,
  isClientIdConfigured,
  revokeToken,
  type AuthConfig,
} from './shared/driveSync/auth';
import { createDriveClient } from './shared/driveSync/driveClient';
import { createSyncEngine, type SyncAdapter, type SyncEngine } from './shared/driveSync/engine';
import type { DriveAccount, DriveErrorInfo, DriveSyncStatus } from './shared/driveSync/types';
import {
  LEGACY_V1_FILE_NAME,
  SYNC_FILE_NAME,
  SYNC_FORMAT,
  SYNC_SCHEMA_VERSION,
  applyDocToLocal,
  buildLocalDoc,
  convertV1Text,
  dedupeBookmarksByUrl,
  parseRemoteSyncText,
  type LocalSyncState,
} from './sync/bookmarkSyncDoc';

/**
 * Google OAuth client (type: Web application) in the Bookmark Manager Cloud project.
 * Override at build time with VITE_GOOGLE_CLIENT_ID. A client ID is not a secret.
 */
const DEFAULT_CLIENT_ID = '541211678956-ong01a9c2flbdq9992bitigc0glg8k30.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID: string =
  (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || DEFAULT_CLIENT_ID;

export const DRIVE_STORAGE_KEYS = {
  state: 'bm_drive_state',
  token: 'bm_gdrive_token',
  deviceId: 'bm_drive_device_id',
  backup: 'bm_drive_backup',
  legacyMeta: 'bm_gdrive_meta',
} as const;

export const DRIVE_ALARMS = {
  periodic: 'bm-gdrive-auto-sync',
  debounce: 'bm-gdrive-debounce',
  retry: 'bm-gdrive-retry',
  periodMinutes: 15,
} as const;

const AUTH: AuthConfig = {
  clientId: GOOGLE_CLIENT_ID,
  scopes: [DRIVE_APPDATA_SCOPE],
  tokenStorageKey: DRIVE_STORAGE_KEYS.token,
};

// ─── Status shape sent to the UI ────────────────────────────────────────────

export interface GDriveStatus {
  configured: boolean;
  status: DriveSyncStatus;
  /** Signed in (may still need re-auth) */
  connected: boolean;
  needsReauth: boolean;
  syncing: boolean;
  account: DriveAccount | null;
  email: string | null;
  lastSyncAt: number | null;
  lastError: DriveErrorInfo | null;
  backupAt: number | null;
  extensionId: string;
  redirectUri: string;
}

/** Lightweight status for popup / sidebar */
export interface GDriveUiStatus {
  connected: boolean;
  needsReauth?: boolean;
  email: string | null;
  lastSyncAt: number | null;
  busy?: boolean;
}

export interface DriveBackup {
  kind: 'bookmark-manager-drive-backup';
  savedAt: number;
  exportDate: string;
  version: string;
  bookmarks: unknown[];
  collections: unknown[];
  settings: unknown;
}

// ─── Host hooks supplied by background.ts ───────────────────────────────────

export interface LocalStore {
  /** Snapshot of local sync-relevant state (from the in-memory cache). */
  read(): Promise<LocalSyncState>;
  /**
   * Run `mutate` synchronously against the freshest cached state and persist its result.
   * Must not await between reading the cache and committing `mutate`'s return value.
   */
  transact(mutate: (current: LocalSyncState) => LocalSyncState | null): Promise<void>;
  isAutoSyncEnabled(): Promise<boolean>;
}

async function getOrCreateDeviceId(): Promise<string> {
  const res = await chrome.storage.local.get(DRIVE_STORAGE_KEYS.deviceId);
  const existing = res[DRIVE_STORAGE_KEYS.deviceId];
  if (typeof existing === 'string' && existing) return existing;
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const id = `dev_${Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  await chrome.storage.local.set({ [DRIVE_STORAGE_KEYS.deviceId]: id });
  return id;
}

let cachedDeviceId: string | null = null;
export async function getDeviceId(): Promise<string> {
  if (!cachedDeviceId) cachedDeviceId = await getOrCreateDeviceId();
  return cachedDeviceId;
}

/** Carry over "connected" from the pre-v2 meta key so users don't have to reconnect. */
async function migrateLegacyMeta(): Promise<void> {
  const res = await chrome.storage.local.get([DRIVE_STORAGE_KEYS.legacyMeta, DRIVE_STORAGE_KEYS.state]);
  const old = res[DRIVE_STORAGE_KEYS.legacyMeta] as
    | { connected?: boolean; email?: string | null; lastSyncAt?: number | null }
    | undefined;
  if (!old) return;
  if (!res[DRIVE_STORAGE_KEYS.state]) {
    await chrome.storage.local.set({
      [DRIVE_STORAGE_KEYS.state]: {
        status: old.connected ? 'idle' : 'signed_out',
        signedIn: Boolean(old.connected),
        account: old.email ? { email: old.email } : null,
        // Not carried over: the v2 file has never been synced from this device yet.
        lastSyncAt: null,
        lastAttemptAt: null,
        lastError: null,
        backupAt: null,
        failureCount: 0,
        migratedFrom: null,
      },
    });
  }
  await chrome.storage.local.remove(DRIVE_STORAGE_KEYS.legacyMeta);
}

export function createBookmarkDriveSync(store: LocalStore) {
  const client = createDriveClient({
    get: async () => (await getAccessToken(AUTH, { interactive: false })).accessToken,
    refresh: async () => (await getAccessToken(AUTH, { interactive: false, forceRefresh: true })).accessToken,
  });

  const adapter: SyncAdapter = {
    fileName: SYNC_FILE_NAME,
    legacyFileNames: [LEGACY_V1_FILE_NAME],
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    getDeviceId,
    async buildLocalDoc() {
      const deviceId = await getDeviceId();
      return buildLocalDoc(await store.read(), deviceId);
    },
    parseRemote: parseRemoteSyncText,
    convertLegacy: (_name, text) => convertV1Text(text),
    normalize: dedupeBookmarksByUrl,
    async updateLocal(fn) {
      const deviceId = await getDeviceId();
      await store.transact((current) => {
        const next = fn(buildLocalDoc(current, deviceId));
        return next ? applyDocToLocal(current, next) : null;
      });
    },
    async saveBackup(_local, savedAt) {
      const snap = await store.read();
      const backup: DriveBackup = {
        kind: 'bookmark-manager-drive-backup',
        savedAt,
        exportDate: new Date(savedAt).toISOString(),
        version: '1.2',
        bookmarks: snap.bookmarks,
        collections: snap.collections,
        settings: snap.settings,
      };
      await chrome.storage.local.set({ [DRIVE_STORAGE_KEYS.backup]: backup });
    },
  };

  const engine: SyncEngine = createSyncEngine({
    adapter,
    client,
    stateKey: DRIVE_STORAGE_KEYS.state,
    isConfigured: () => isClientIdConfigured(GOOGLE_CLIENT_ID),
    signInInteractive: async () => {
      await getAccessToken(AUTH, { interactive: true, forceRefresh: true });
    },
    ensureToken: async () => {
      await getAccessToken(AUTH, { interactive: false });
    },
    revoke: () => revokeToken(AUTH),
    isAutoSyncEnabled: () => store.isAutoSyncEnabled(),
    alarms: DRIVE_ALARMS,
  });

  const ready = migrateLegacyMeta().catch(() => undefined);

  async function getStatus(): Promise<GDriveStatus> {
    await ready;
    const st = await engine.getState();
    return {
      configured: isClientIdConfigured(GOOGLE_CLIENT_ID),
      status: st.status,
      connected: st.signedIn,
      needsReauth: st.status === 'needs_reauth',
      syncing: st.status === 'syncing' || engine.isBusy(),
      account: st.account,
      email: st.account?.email ?? null,
      lastSyncAt: st.lastSyncAt,
      lastError: st.lastError,
      backupAt: st.backupAt,
      extensionId: chrome.runtime.id,
      redirectUri: getRedirectUri(),
    };
  }

  async function getBackup(): Promise<DriveBackup | null> {
    const res = await chrome.storage.local.get(DRIVE_STORAGE_KEYS.backup);
    return (res[DRIVE_STORAGE_KEYS.backup] as DriveBackup | undefined) ?? null;
  }

  return {
    engine,
    ready,
    getStatus,
    getBackup,
    forgetToken: () => forgetToken(AUTH),
  };
}

export type BookmarkDriveSync = ReturnType<typeof createBookmarkDriveSync>;
