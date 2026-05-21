import type { AppState, AppSettings, Bookmark, Collection } from './types';

const KEYS = {
  bookmarks: 'bm_bookmarks',
  collections: 'bm_collections',
  settings: 'settings',
} as const;

// ─── Persistence helpers ──────────────────────────────────────────────────────
// All state mutations live in `background.ts` (with an in-memory cache).
// This module only owns the I/O boundary with `chrome.storage.local`.

export async function saveBookmarks(bookmarks: Bookmark[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.bookmarks]: bookmarks });
}

export async function saveCollections(collections: Collection[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.collections]: collections });
}

export async function getInitialState(): Promise<AppState> {
  const result = await chrome.storage.local.get([KEYS.bookmarks, KEYS.collections, KEYS.settings]);
  return {
    bookmarks: (result[KEYS.bookmarks] as Bookmark[] | undefined) ?? [],
    collections: (result[KEYS.collections] as Collection[] | undefined) ?? [],
    settings: (result[KEYS.settings] as AppSettings | undefined) ?? { enableAi: false },
  };
}
