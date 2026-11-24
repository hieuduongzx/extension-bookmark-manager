/**
 * Shared Google Drive sync module — types.
 *
 * This folder (`src/shared/driveSync/`) is app-agnostic: it must not import anything
 * from the host app. Keep it copy-able verbatim between Bookmark Manager and TubeDeck2k.
 * Internal imports use explicit `.ts` extensions so `node --test` can load them directly.
 */

/** One entity in a sync document. Deletions are tombstones: `deletedAt` set, `data` null. */
export interface SyncRecord<T = unknown> {
  updatedAt: number;
  deviceId: string;
  deletedAt: number | null;
  data: T | null;
}

export type RecordMap<T = unknown> = Record<string, SyncRecord<T>>;

/** A single last-write-wins value (used for settings). */
export interface SyncRegister<S = unknown> {
  value: S | null;
  updatedAt: number;
  deviceId: string;
}

/** The JSON document stored in Drive `appDataFolder`. */
export interface SyncDocument {
  /** e.g. "bookmark-manager-sync" */
  format: string;
  schemaVersion: number;
  updatedAt: number;
  lastDeviceId: string;
  /** kind → (id → record), e.g. { bookmarks: {...}, collections: {...} } */
  entities: Record<string, RecordMap>;
  settings: SyncRegister;
}

export type DriveSyncStatus =
  | 'unconfigured'
  | 'signed_out'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'error'
  | 'needs_reauth';

export type DriveErrorCode =
  | 'not_configured'
  | 'redirect_uri_mismatch'
  | 'invalid_client'
  | 'access_denied'
  | 'oauth_disabled'
  | 'cancelled'
  | 'user_gesture'
  | 'auth_failed'
  | 'needs_reauth'
  | 'api_disabled'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'offline'
  | 'corrupt_remote'
  | 'schema_too_new'
  | 'conflict'
  | 'http'
  | 'unknown';

export interface DriveErrorInfo {
  code: DriveErrorCode;
  status?: number;
  detail?: string;
  at: number;
}

export class DriveSyncError extends Error {
  code: DriveErrorCode;
  status?: number;
  detail?: string;

  constructor(code: DriveErrorCode, message?: string, opts: { status?: number; detail?: string } = {}) {
    super(message || code);
    this.name = 'DriveSyncError';
    this.code = code;
    this.status = opts.status;
    this.detail = opts.detail;
  }

  get retryable(): boolean {
    return this.code === 'network' || this.code === 'rate_limited' || this.code === 'server' || this.code === 'conflict';
  }
}

export function toDriveErrorInfo(err: unknown, now = Date.now()): DriveErrorInfo {
  if (err instanceof DriveSyncError) {
    return { code: err.code, status: err.status, detail: err.detail ?? err.message, at: now };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'unknown', detail: message, at: now };
}

export interface DriveAccount {
  email?: string;
  displayName?: string;
  photoUrl?: string;
}

export interface DriveFileMeta {
  id: string;
  name?: string;
  version?: string;
  modifiedTime?: string;
  createdTime?: string;
}

export interface DriveSyncState {
  status: DriveSyncStatus;
  signedIn: boolean;
  account: DriveAccount | null;
  /** Last successful sync (ms) */
  lastSyncAt: number | null;
  lastAttemptAt: number | null;
  lastError: DriveErrorInfo | null;
  /** When the latest pre-merge local backup was saved */
  backupAt: number | null;
  /** Consecutive failures with a retryable error (drives retry backoff) */
  failureCount: number;
  /** Legacy file name the data was first imported from, if any */
  migratedFrom: string | null;
}

export const DEFAULT_DRIVE_SYNC_STATE: DriveSyncState = {
  status: 'signed_out',
  signedIn: false,
  account: null,
  lastSyncAt: null,
  lastAttemptAt: null,
  lastError: null,
  backupAt: null,
  failureCount: 0,
  migratedFrom: null,
};

export const DAY_MS = 86_400_000;
/** Tombstones older than this are dropped from the sync document. */
export const TOMBSTONE_RETENTION_MS = 180 * DAY_MS;
