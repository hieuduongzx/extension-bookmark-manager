import type { AppSettings, AppState, Bookmark, Collection } from './types';
import { DEFAULT_SETTINGS } from './types';

const KEYS = {
  bookmarks: 'bm_bookmarks',
  collections: 'bm_collections',
  settings: 'bm_settings',
  tombstones: 'bm_tombstones',
} as const;

/** id → deletedAt (ms). Lets deletions win over stale remote copies during sync. */
export interface Tombstones {
  bookmarks: Record<string, number>;
  collections: Record<string, number>;
}

export const EMPTY_TOMBSTONES: Tombstones = { bookmarks: {}, collections: {} };

/** Drop tombstones older than this so the record can't grow forever. */
export const TOMBSTONE_RETENTION_MS = 90 * 86_400_000;

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

/** Record deletions locally so the next sync propagates them instead of resurrecting. */
export async function recordTombstones(
  kind: keyof Tombstones,
  ids: string[],
  at = Date.now()
): Promise<void> {
  if (ids.length === 0) return;
  const current = await loadTombstones();
  for (const id of ids) current[kind][id] = at;
  await saveTombstones(current);
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

export { KEYS as STORAGE_KEYS };
