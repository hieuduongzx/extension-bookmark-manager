import type { AppSettings, AppState, Bookmark, Collection } from './types';
import { DEFAULT_SETTINGS } from './types';
import { TOMBSTONE_RETENTION_MS } from './shared/driveSync/types';
import type { SettingsMeta, SyncOrigins, Tombstones } from './sync/bookmarkSyncDoc';

export type { Tombstones } from './sync/bookmarkSyncDoc';

const KEYS = {
  bookmarks: 'bm_bookmarks',
  collections: 'bm_collections',
  settings: 'bm_settings',
  tombstones: 'bm_tombstones',
  /** { updatedAt, deviceId } of the last change to roaming settings (Drive LWW) */
  settingsMeta: 'bm_sync_settings_meta',
  /** kind:id → { u: updatedAt, d: deviceId } as last seen in the Drive document */
  origins: 'bm_sync_origins',
} as const;

export const EMPTY_TOMBSTONES: Tombstones = { bookmarks: {}, collections: {} };

/** id → deletedAt tombstones are kept this long (shared with the Drive document). */
export { TOMBSTONE_RETENTION_MS };

// ─── Persistence helpers ──────────────────────────────────────────────────────
// All state mutations live in `background.ts` (with an in-memory cache).
// This module only owns the I/O boundary with `chrome.storage.local`.

export async function saveBookmarks(bookmarks: Bookmark[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.bookmarks]: bookmarks });
}

export async function saveCollections(collections: Collection[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.collections]: collections });
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ [KEYS.settings]: settings });
}

function mergeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(raw as Partial<AppSettings>) };
}

export async function getInitialState(): Promise<AppState> {
  const result = await chrome.storage.local.get([
    KEYS.bookmarks,
    KEYS.collections,
    KEYS.settings,
  ]);
  // Guard against a corrupt (non-array) stored value that would later throw on .map/.filter.
  const rawBookmarks = result[KEYS.bookmarks];
  const rawCollections = result[KEYS.collections];
  return {
    bookmarks: Array.isArray(rawBookmarks) ? (rawBookmarks as Bookmark[]) : [],
    collections: Array.isArray(rawCollections) ? (rawCollections as Collection[]) : [],
    settings: mergeSettings(result[KEYS.settings]),
  };
}

// ─── Tombstones ────────────────────────────────────────────────────────────────

export async function loadTombstones(): Promise<Tombstones> {
  const result = await chrome.storage.local.get(KEYS.tombstones);
  const raw = result[KEYS.tombstones] as Partial<Tombstones> | undefined;
  return {
    bookmarks: raw?.bookmarks && typeof raw.bookmarks === 'object' ? raw.bookmarks : {},
    collections: raw?.collections && typeof raw.collections === 'object' ? raw.collections : {},
  };
}

export async function saveTombstones(tombstones: Tombstones): Promise<void> {
  await chrome.storage.local.set({ [KEYS.tombstones]: pruneTombstones(tombstones) });
}

export function pruneTombstones(tombstones: Tombstones, now = Date.now()): Tombstones {
  const cutoff = now - TOMBSTONE_RETENTION_MS;
  const prune = (record: Record<string, number>) =>
    Object.fromEntries(Object.entries(record).filter(([, ts]) => ts >= cutoff));
  return {
    bookmarks: prune(tombstones.bookmarks),
    collections: prune(tombstones.collections),
  };
}

// ─── Drive sync metadata ──────────────────────────────────────────────────────

export interface SyncExtras {
  tombstones: Tombstones;
  settingsMeta: SettingsMeta;
  origins: SyncOrigins;
}

export async function loadSyncExtras(): Promise<SyncExtras> {
  const result = await chrome.storage.local.get([KEYS.settingsMeta, KEYS.origins]);
  const meta = result[KEYS.settingsMeta] as Partial<SettingsMeta> | undefined;
  const origins = result[KEYS.origins];
  return {
    tombstones: await loadTombstones(),
    settingsMeta: {
      updatedAt: typeof meta?.updatedAt === 'number' ? meta.updatedAt : 0,
      deviceId: typeof meta?.deviceId === 'string' ? meta.deviceId : '',
    },
    origins: origins && typeof origins === 'object' ? (origins as SyncOrigins) : {},
  };
}

export async function saveSettingsMeta(meta: SettingsMeta): Promise<void> {
  await chrome.storage.local.set({ [KEYS.settingsMeta]: meta });
}

export async function saveSyncOrigins(origins: SyncOrigins): Promise<void> {
  await chrome.storage.local.set({ [KEYS.origins]: origins });
}

export { KEYS as STORAGE_KEYS };
