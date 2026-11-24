/**
 * Shared Google Drive sync module — generic record merge (app-agnostic).
 *
 * Rules:
 * - Per-record last-write-wins on `updatedAt`.
 * - Equal `updatedAt` → higher `deviceId` wins; still equal → larger serialized content wins.
 *   Every device therefore picks the same winner (merge is deterministic and convergent).
 * - Deletions are tombstones (`deletedAt` set) and take part in LWW like any edit.
 * - Tombstones older than the retention window are pruned.
 */
import {
  DriveSyncError,
  TOMBSTONE_RETENTION_MS,
  type RecordMap,
  type SyncDocument,
  type SyncRecord,
  type SyncRegister,
} from './types.ts';

export class CorruptRemoteDataError extends DriveSyncError {
  constructor(detail: string) {
    super('corrupt_remote', detail, { detail });
    this.name = 'CorruptRemoteDataError';
  }
}

// ─── Deterministic comparison ───────────────────────────────────────────────

/** JSON.stringify with sorted object keys (undefined values dropped, like JSON). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

interface Versioned {
  updatedAt: number;
  deviceId?: string;
}

/** Which side wins under LWW. Pure and symmetric: swapping sides swaps the answer. */
export function pickWinner<T extends Versioned>(local: T, remote: T): 'local' | 'remote' {
  if (remote.updatedAt > local.updatedAt) return 'remote';
  if (local.updatedAt > remote.updatedAt) return 'local';
  const ld = local.deviceId ?? '';
  const rd = remote.deviceId ?? '';
  if (rd > ld) return 'remote';
  if (ld > rd) return 'local';
  return stableStringify(remote) > stableStringify(local) ? 'remote' : 'local';
}

// ─── Record maps ────────────────────────────────────────────────────────────

export interface MapMergeOptions {
  now?: number;
  retentionMs?: number;
  /**
   * Local-only live records with `updatedAt <= staleBefore` are treated as deleted remotely.
   * Set by the engine when this device was offline longer than the tombstone retention,
   * so a deletion whose tombstone was already pruned cannot be resurrected by a stale copy.
   */
  staleBefore?: number;
}

export interface MapMergeResult<T> {
  merged: RecordMap<T>;
  changedLocal: boolean;
  changedRemote: boolean;
}

export function isTombstone(rec: SyncRecord<unknown>): boolean {
  return rec.deletedAt !== null && rec.deletedAt !== undefined;
}

export function pruneTombstones<T>(
  map: RecordMap<T>,
  now = Date.now(),
  retentionMs = TOMBSTONE_RETENTION_MS
): RecordMap<T> {
  const cutoff = now - retentionMs;
  const out: RecordMap<T> = {};
  for (const [id, rec] of Object.entries(map)) {
    if (isTombstone(rec) && (rec.deletedAt as number) < cutoff) continue;
    out[id] = rec;
  }
  return out;
}

export function mergeRecordMaps<T>(
  local: RecordMap<T>,
  remote: RecordMap<T>,
  opts: MapMergeOptions = {}
): MapMergeResult<T> {
  const now = opts.now ?? Date.now();
  const retentionMs = opts.retentionMs ?? TOMBSTONE_RETENTION_MS;
  const merged: RecordMap<T> = {};

  const ids = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const id of ids) {
    const l = local[id];
    const r = remote[id];
    if (l && !r) {
      if (
        opts.staleBefore !== undefined &&
        !isTombstone(l) &&
        l.updatedAt <= opts.staleBefore
      ) {
        // Remote forgot this record (pruned tombstone) and we have not touched it since.
        continue;
      }
      merged[id] = l;
    } else if (!l && r) {
      merged[id] = r;
    } else if (l && r) {
      merged[id] = pickWinner(l, r) === 'remote' ? r : l;
    }
  }

  const pruned = pruneTombstones(merged, now, retentionMs);
  return {
    merged: pruned,
    changedLocal: !deepEqual(pruned, local),
    changedRemote: !deepEqual(pruned, remote),
  };
}

export function mergeRegister<S>(local: SyncRegister<S>, remote: SyncRegister<S>): SyncRegister<S> {
  return pickWinner(local, remote) === 'remote' ? remote : local;
}

// ─── Documents ──────────────────────────────────────────────────────────────

export interface DocMergeOptions extends MapMergeOptions {
  deviceId: string;
  format: string;
  schemaVersion: number;
}

export interface DocMergeResult {
  merged: SyncDocument;
  changedLocal: boolean;
  changedRemote: boolean;
}

export function emptyDocument(format: string, schemaVersion: number): SyncDocument {
  return {
    format,
    schemaVersion,
    updatedAt: 0,
    lastDeviceId: '',
    entities: {},
    settings: { value: null, updatedAt: 0, deviceId: '' },
  };
}

/** Compare the payload of two documents, ignoring the envelope (`updatedAt`, `lastDeviceId`). */
export function documentContentEqual(a: SyncDocument, b: SyncDocument): boolean {
  return deepEqual(
    { entities: nonEmptyKinds(a.entities), settings: a.settings },
    { entities: nonEmptyKinds(b.entities), settings: b.settings }
  );
}

function nonEmptyKinds(entities: Record<string, RecordMap>): Record<string, RecordMap> {
  const out: Record<string, RecordMap> = {};
  for (const [kind, map] of Object.entries(entities)) {
    if (Object.keys(map).length > 0) out[kind] = map;
  }
  return out;
}

export function mergeDocuments(
  local: SyncDocument,
  remote: SyncDocument,
  opts: DocMergeOptions
): DocMergeResult {
  const now = opts.now ?? Date.now();
  const entities: Record<string, RecordMap> = {};
  const kinds = new Set([...Object.keys(local.entities), ...Object.keys(remote.entities)]);
  for (const kind of kinds) {
    entities[kind] = mergeRecordMaps(local.entities[kind] ?? {}, remote.entities[kind] ?? {}, {
      ...opts,
      now,
    }).merged;
  }
  const settings = mergeRegister(local.settings, remote.settings);

  const merged: SyncDocument = {
    format: opts.format,
    schemaVersion: opts.schemaVersion,
    updatedAt: Math.max(now, local.updatedAt, remote.updatedAt),
    lastDeviceId: opts.deviceId,
    entities,
    settings,
  };
  return {
    merged,
    changedLocal: !documentContentEqual(merged, local),
    changedRemote: !documentContentEqual(merged, remote),
  };
}

// ─── Validation of untrusted remote JSON ────────────────────────────────────

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function isTimestamp(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

export interface DocumentSchema {
  format: string;
  schemaVersion: number;
  /** Per entity kind: return clean data or null to drop that record. */
  sanitizers: Record<string, (id: string, data: unknown) => unknown | null>;
  /** Return clean settings value or null. */
  sanitizeSettings?: (value: unknown) => unknown | null;
}

/** Parse JSON text from Drive and validate it strictly. Throws CorruptRemoteDataError. */
export function parseRemoteDocument(text: string, schema: DocumentSchema): SyncDocument {
  if (typeof text !== 'string' || !text.trim()) {
    throw new CorruptRemoteDataError('Sync file on Drive is empty.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CorruptRemoteDataError('Sync file on Drive is not valid JSON.');
  }
  return validateDocument(parsed, schema);
}

export function validateDocument(parsed: unknown, schema: DocumentSchema): SyncDocument {
  if (!isPlainObject(parsed)) {
    throw new CorruptRemoteDataError('Sync file structure is broken.');
  }
  if (parsed.format !== schema.format) {
    throw new CorruptRemoteDataError(`Unexpected sync file format "${String(parsed.format)}".`);
  }
  const version = parsed.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new CorruptRemoteDataError('Sync file has no valid schemaVersion.');
  }
  if (version > schema.schemaVersion) {
    throw new DriveSyncError(
      'schema_too_new',
      `Sync file schema v${version} is newer than this extension (v${schema.schemaVersion}).`,
      { detail: `v${version} > v${schema.schemaVersion}` }
    );
  }
  if (!isPlainObject(parsed.entities)) {
    throw new CorruptRemoteDataError('Sync file is missing "entities".');
  }

  const entities: Record<string, RecordMap> = {};
  for (const [kind, sanitize] of Object.entries(schema.sanitizers)) {
    const rawMap = parsed.entities[kind];
    if (rawMap === undefined) {
      entities[kind] = {};
      continue;
    }
    if (!isPlainObject(rawMap)) {
      throw new CorruptRemoteDataError(`Sync file: "${kind}" is not an object.`);
    }
    const map: RecordMap = {};
    for (const [id, rawRec] of Object.entries(rawMap)) {
      if (!id || !isPlainObject(rawRec) || !isTimestamp(rawRec.updatedAt)) {
        throw new CorruptRemoteDataError(`Sync file: broken ${kind} record "${id}".`);
      }
      const deviceId = typeof rawRec.deviceId === 'string' ? rawRec.deviceId : '';
      if (rawRec.deletedAt !== null && rawRec.deletedAt !== undefined) {
        if (!isTimestamp(rawRec.deletedAt)) {
          throw new CorruptRemoteDataError(`Sync file: broken ${kind} tombstone "${id}".`);
        }
        map[id] = { updatedAt: rawRec.updatedAt, deviceId, deletedAt: rawRec.deletedAt, data: null };
        continue;
      }
      const data = sanitize(id, rawRec.data);
      if (data === null || data === undefined) continue; // unusable record: skip, keep the rest
      map[id] = { updatedAt: rawRec.updatedAt, deviceId, deletedAt: null, data };
    }
    entities[kind] = map;
  }

  let settings: SyncDocument['settings'] = { value: null, updatedAt: 0, deviceId: '' };
  if (isPlainObject(parsed.settings) && isTimestamp(parsed.settings.updatedAt)) {
    const value = schema.sanitizeSettings
      ? schema.sanitizeSettings(parsed.settings.value)
      : parsed.settings.value ?? null;
    settings = {
      value: value ?? null,
      updatedAt: parsed.settings.updatedAt,
      deviceId: typeof parsed.settings.deviceId === 'string' ? parsed.settings.deviceId : '',
    };
  }

  return {
    format: schema.format,
    schemaVersion: version,
    updatedAt: isTimestamp(parsed.updatedAt) ? parsed.updatedAt : 0,
    lastDeviceId: typeof parsed.lastDeviceId === 'string' ? parsed.lastDeviceId : '',
    entities,
    settings,
  };
}
