/**
 * Bookmark Manager ↔ shared Drive sync document (schema v2).
 * Pure functions (no chrome.*) so they can be unit-tested with `node --test`.
 *
 * Remote file `bookmark-manager-sync-v2.json`:
 * {
 *   format: "bookmark-manager-sync", schemaVersion: 2, updatedAt, lastDeviceId,
 *   entities: {
 *     bookmarks:   { <id>: { updatedAt, deviceId, deletedAt, data: Bookmark | null } },
 *     collections: { <id>: { updatedAt, deviceId, deletedAt, data: Collection | null } }
 *   },
 *   settings: { value: { theme, locale, ... }, updatedAt, deviceId }
 * }
 */
import type { AppSettings, Bookmark, Collection } from '../types';
import {
  canonicalizeUrlForMatch,
  getDomain,
  getFavicon,
  isSafeBookmarkUrl,
  sanitizeBookmarkUrl,
} from '../utils';
import {
  CorruptRemoteDataError,
  deepEqual,
  isPlainObject,
  parseRemoteDocument,
  type DocumentSchema,
} from '../shared/driveSync/merge';
import type { RecordMap, SyncDocument, SyncRecord, SyncRegister } from '../shared/driveSync/types';

export const SYNC_FORMAT = 'bookmark-manager-sync';
export const SYNC_SCHEMA_VERSION = 2;
export const SYNC_FILE_NAME = 'bookmark-manager-sync-v2.json';
/** v1 file written by Bookmark Manager ≤ 1.2.0 — read once for migration, never deleted. */
export const LEGACY_V1_FILE_NAME = 'bookmark-manager-sync.json';

export const KIND_BOOKMARKS = 'bookmarks';
export const KIND_COLLECTIONS = 'collections';

/**
 * Settings that roam between devices (LWW as one value).
 * `gdriveAutoSync` is deliberately per-device: turning it off on one machine must not
 * silently stop syncing everywhere.
 */
export const SYNCED_SETTING_KEYS = [
  'theme',
  'locale',
  'defaultCollectionId',
  'defaultSort',
  'defaultViewMode',
  'fetchPreviews',
  'trashAutoEmptyDays',
  'showQuickSave',
  'openInSidePanel',
] as const satisfies readonly (keyof AppSettings)[];

export type SyncedSettings = Partial<Pick<AppSettings, (typeof SYNCED_SETTING_KEYS)[number]>>;

export interface Tombstones {
  bookmarks: Record<string, number>;
  collections: Record<string, number>;
}

export interface SettingsMeta {
  updatedAt: number;
  deviceId: string;
}

/** kind:id → last synced { updatedAt, deviceId }, so unchanged records keep their origin device. */
export type SyncOrigins = Record<string, { u: number; d: string }>;

export interface LocalSyncState {
  bookmarks: Bookmark[];
  collections: Collection[];
  settings: AppSettings;
  tombstones: Tombstones;
  settingsMeta: SettingsMeta;
  origins: SyncOrigins;
}

// ─── Sanitizers (shared by local + remote paths) ────────────────────────────

function normalizeTags(tags: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function sanitizeBookmark(raw: unknown, fallbackTs = 0): Bookmark | null {
  if (!isPlainObject(raw)) return null;
  const b = raw as Partial<Bookmark>;
  const safeUrl = sanitizeBookmarkUrl(typeof b.url === 'string' ? b.url : '');
  if (!safeUrl || typeof b.id !== 'string' || !b.id) return null;
  const updatedAt = num(b.updatedAt) ?? num(b.createdAt) ?? fallbackTs;
  return {
    ...(b as Bookmark),
    id: b.id,
    url: safeUrl,
    title: typeof b.title === 'string' ? b.title : getDomain(safeUrl),
    favicon: typeof b.favicon === 'string' ? b.favicon : getFavicon(safeUrl),
    tags: normalizeTags(b.tags),
    note: typeof b.note === 'string' ? b.note : undefined,
    collectionId: typeof b.collectionId === 'string' && b.collectionId ? b.collectionId : '__unsorted__',
    createdAt: num(b.createdAt) ?? updatedAt,
    updatedAt,
    pinned: Boolean(b.pinned),
    coverUrl: typeof b.coverUrl === 'string' && isSafeBookmarkUrl(b.coverUrl) ? b.coverUrl : undefined,
    previousCollectionId: typeof b.previousCollectionId === 'string' ? b.previousCollectionId : undefined,
    linkStatus: num(b.linkStatus),
    lastCheckedAt: num(b.lastCheckedAt),
    order: num(b.order),
  };
}

export function sanitizeCollection(raw: unknown, fallbackTs = 0): Collection | null {
  if (!isPlainObject(raw)) return null;
  const c = raw as Partial<Collection>;
  if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string') return null;
  const createdAt = num(c.createdAt) ?? num(c.updatedAt) ?? fallbackTs;
  return {
    ...(c as Collection),
    id: c.id,
    name: c.name,
    icon: (typeof c.icon === 'string' ? c.icon : 'folder') as Collection['icon'],
    color: (typeof c.color === 'string' ? c.color : 'blue') as Collection['color'],
    parentId: typeof c.parentId === 'string' && c.parentId ? c.parentId : undefined,
    pinned: Boolean(c.pinned),
    createdAt,
    updatedAt: num(c.updatedAt) ?? createdAt,
  };
}

const SETTING_VALIDATORS: Record<(typeof SYNCED_SETTING_KEYS)[number], (v: unknown) => boolean> = {
  theme: (v) => v === 'light' || v === 'dark' || v === 'system',
  locale: (v) => v === 'en' || v === 'vi',
  defaultCollectionId: (v) => typeof v === 'string' && v.length > 0,
  defaultSort: (v) => typeof v === 'string' && ['newest', 'oldest', 'a-z', 'z-a', 'domain', 'updated'].includes(v),
  defaultViewMode: (v) => typeof v === 'string' && ['grid', 'list', 'masonry', 'folder'].includes(v),
  fetchPreviews: (v) => typeof v === 'boolean',
  trashAutoEmptyDays: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  showQuickSave: (v) => typeof v === 'boolean',
  openInSidePanel: (v) => typeof v === 'boolean',
};

export function pickSyncedSettings(raw: unknown): SyncedSettings | null {
  if (!isPlainObject(raw)) return null;
  const out: Record<string, unknown> = {};
  for (const key of SYNCED_SETTING_KEYS) {
    if (key in raw && SETTING_VALIDATORS[key](raw[key])) out[key] = raw[key];
  }
  return Object.keys(out).length > 0 ? (out as SyncedSettings) : null;
}

export const SYNC_DOCUMENT_SCHEMA: DocumentSchema = {
  format: SYNC_FORMAT,
  schemaVersion: SYNC_SCHEMA_VERSION,
  sanitizers: {
    [KIND_BOOKMARKS]: (id, data) => {
      const b = sanitizeBookmark(data);
      return b && b.id === id ? b : null;
    },
    [KIND_COLLECTIONS]: (id, data) => {
      const c = sanitizeCollection(data);
      return c && c.id === id ? c : null;
    },
  },
  sanitizeSettings: pickSyncedSettings,
};

export function parseRemoteSyncText(text: string): SyncDocument {
  return parseRemoteDocument(text, SYNC_DOCUMENT_SCHEMA);
}

// ─── Local state → document ─────────────────────────────────────────────────

export function originKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function buildLocalDoc(local: LocalSyncState, deviceId: string): SyncDocument {
  const deviceFor = (kind: string, id: string, updatedAt: number) => {
    const o = local.origins[originKey(kind, id)];
    return o && o.u === updatedAt ? o.d : deviceId;
  };

  const bookmarks: RecordMap<Bookmark> = {};
  for (const raw of local.bookmarks) {
    const b = sanitizeBookmark(raw);
    if (!b) continue;
    bookmarks[b.id] = {
      updatedAt: b.updatedAt,
      deviceId: deviceFor(KIND_BOOKMARKS, b.id, b.updatedAt),
      deletedAt: null,
      data: b,
    };
  }
  for (const [id, ts] of Object.entries(local.tombstones.bookmarks)) {
    if (typeof ts !== 'number') continue;
    const live = bookmarks[id];
    if (live && live.updatedAt > ts) continue; // re-added after deletion
    bookmarks[id] = { updatedAt: ts, deviceId: deviceFor(KIND_BOOKMARKS, id, ts), deletedAt: ts, data: null };
  }

  const collections: RecordMap<Collection> = {};
  for (const raw of local.collections) {
    const c = sanitizeCollection(raw);
    if (!c) continue;
    const u = c.updatedAt ?? c.createdAt;
    collections[c.id] = { updatedAt: u, deviceId: deviceFor(KIND_COLLECTIONS, c.id, u), deletedAt: null, data: c };
  }
  for (const [id, ts] of Object.entries(local.tombstones.collections)) {
    if (typeof ts !== 'number') continue;
    const live = collections[id];
    if (live && live.updatedAt > ts) continue;
    collections[id] = { updatedAt: ts, deviceId: deviceFor(KIND_COLLECTIONS, id, ts), deletedAt: ts, data: null };
  }

  const settings: SyncRegister<SyncedSettings> = {
    value: pickSyncedSettings(local.settings),
    updatedAt: local.settingsMeta.updatedAt,
    deviceId: local.settingsMeta.deviceId,
  };

  return {
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: 0,
    lastDeviceId: deviceId,
    entities: { [KIND_BOOKMARKS]: bookmarks, [KIND_COLLECTIONS]: collections },
    settings,
  };
}

// ─── Document → local state (per record, keeps local order) ─────────────────

function applyList<T extends { id: string; createdAt: number }>(
  current: T[],
  map: RecordMap,
  placeNew: 'front' | 'back',
  isSyncable: (item: T) => boolean
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of current) {
    const rec = map[item.id];
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (!rec) {
      // Items that can't be represented in the document (e.g. unsafe URL) are left alone;
      // syncable items missing from the merged document were dropped on purpose
      // (stale-device guard) and are removed.
      if (!isSyncable(item)) out.push(item);
      continue;
    }
    if (rec.deletedAt !== null || !rec.data) continue;
    out.push(rec.data as T);
  }
  const added = Object.entries(map)
    .filter(([id, rec]) => !seen.has(id) && rec.deletedAt === null && rec.data)
    .map(([, rec]) => rec.data as T)
    .sort((a, b) => (placeNew === 'front' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  return placeNew === 'front' ? [...added, ...out] : [...out, ...added];
}

function tombstonesOf(map: RecordMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, rec] of Object.entries(map)) {
    if (rec.deletedAt !== null) out[id] = rec.deletedAt;
  }
  return out;
}

export function applyDocToLocal(local: LocalSyncState, doc: SyncDocument): LocalSyncState {
  const bMap = doc.entities[KIND_BOOKMARKS] ?? {};
  const cMap = doc.entities[KIND_COLLECTIONS] ?? {};

  const origins: SyncOrigins = {};
  for (const [kind, map] of [
    [KIND_BOOKMARKS, bMap],
    [KIND_COLLECTIONS, cMap],
  ] as const) {
    for (const [id, rec] of Object.entries(map)) origins[originKey(kind, id)] = { u: rec.updatedAt, d: rec.deviceId };
  }

  const value = doc.settings.value as SyncedSettings | null;
  return {
    bookmarks: applyList(local.bookmarks, bMap, 'front', (b) => sanitizeBookmark(b) !== null),
    collections: applyList(local.collections, cMap, 'back', (c) => sanitizeCollection(c) !== null),
    settings: value ? { ...local.settings, ...value } : local.settings,
    settingsMeta: { updatedAt: doc.settings.updatedAt, deviceId: doc.settings.deviceId },
    tombstones: { bookmarks: tombstonesOf(bMap), collections: tombstonesOf(cMap) },
    origins,
  };
}

// ─── Duplicate-URL cleanup (runs after every merge) ─────────────────────────

/** Merge two bookmarks sharing a canonical URL: keep the newer, but don't lose tags/note/cover. */
export function mergeDuplicateBookmarks(a: Bookmark, b: Bookmark): Bookmark {
  const aFirst = a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id < b.id);
  const [newer, older] = aFirst ? [a, b] : [b, a];
  return {
    ...newer,
    tags: Array.from(new Set([...newer.tags, ...older.tags])),
    note: newer.note ?? older.note,
    coverUrl: newer.coverUrl ?? older.coverUrl,
  };
}

export function dedupeBookmarksByUrl(
  doc: SyncDocument,
  ctx: { deviceId: string; now: number }
): SyncDocument {
  const map = doc.entities[KIND_BOOKMARKS];
  if (!map) return doc;
  const next: RecordMap = { ...map };
  const byUrl = new Map<string, string>(); // canonical url → kept id
  const ids = Object.keys(map).sort();
  let changed = false;

  for (const id of ids) {
    const rec = next[id] as SyncRecord<Bookmark>;
    if (!rec || rec.deletedAt !== null || !rec.data) continue;
    const key = canonicalizeUrlForMatch(rec.data.url);
    const keptId = byUrl.get(key);
    if (!keptId) {
      byUrl.set(key, id);
      continue;
    }
    const keptRec = next[keptId] as SyncRecord<Bookmark>;
    const mergedData = mergeDuplicateBookmarks(keptRec.data as Bookmark, rec.data);
    const winnerId = mergedData.id;
    const loserId = winnerId === keptId ? id : keptId;
    const winnerRec = next[winnerId] as SyncRecord<Bookmark>;
    const contentChanged = !deepEqual(mergedData, winnerRec.data);
    next[winnerId] = contentChanged
      ? { updatedAt: ctx.now, deviceId: ctx.deviceId, deletedAt: null, data: { ...mergedData, updatedAt: ctx.now } }
      : winnerRec;
    next[loserId] = { updatedAt: ctx.now, deviceId: ctx.deviceId, deletedAt: ctx.now, data: null };
    byUrl.set(key, winnerId);
    changed = true;
  }
  if (!changed) return doc;
  return { ...doc, entities: { ...doc.entities, [KIND_BOOKMARKS]: next } };
}

// ─── v1 → v2 migration ──────────────────────────────────────────────────────

/** Convert `bookmark-manager-sync.json` (v1) into a v2 document. Throws CorruptRemoteDataError. */
export function convertV1Text(text: string): SyncDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CorruptRemoteDataError('Old sync file (v1) is not valid JSON.');
  }
  if (!isPlainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.bookmarks)) {
    throw new CorruptRemoteDataError('Old sync file (v1) has an invalid format.');
  }
  if (parsed.collections !== undefined && !Array.isArray(parsed.collections)) {
    throw new CorruptRemoteDataError('Old sync file (v1): collections is not a list.');
  }
  const exportedAt = num(parsed.exportedAt) ?? 0;

  const bookmarks: RecordMap<Bookmark> = {};
  for (const raw of parsed.bookmarks) {
    const b = sanitizeBookmark(raw);
    if (b) bookmarks[b.id] = { updatedAt: b.updatedAt, deviceId: '', deletedAt: null, data: b };
  }
  const collections: RecordMap<Collection> = {};
  for (const raw of (parsed.collections as unknown[] | undefined) ?? []) {
    const c = sanitizeCollection(raw);
    if (c) {
      const u = c.updatedAt ?? c.createdAt;
      collections[c.id] = { updatedAt: u, deviceId: '', deletedAt: null, data: c };
    }
  }
  const addTombstones = (map: RecordMap, raw: unknown) => {
    if (!isPlainObject(raw)) return;
    for (const [id, ts] of Object.entries(raw)) {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
      const live = map[id];
      // v1 rule: a deletion wins unless the entity was edited after it.
      if (live && live.updatedAt > ts) continue;
      map[id] = { updatedAt: ts, deviceId: '', deletedAt: ts, data: null };
    }
  };
  addTombstones(bookmarks, parsed.deletedBookmarks);
  addTombstones(collections, parsed.deletedCollections);

  return {
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: exportedAt,
    lastDeviceId: '',
    entities: { [KIND_BOOKMARKS]: bookmarks, [KIND_COLLECTIONS]: collections },
    settings: { value: pickSyncedSettings(parsed.settings), updatedAt: exportedAt, deviceId: '' },
  };
}
