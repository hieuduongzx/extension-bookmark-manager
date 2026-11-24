import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppSettings, Bookmark, Collection } from '../src/types.ts';
import { DEFAULT_SETTINGS } from '../src/types.ts';
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
} from '../src/sync/bookmarkSyncDoc.ts';
import { runSyncCycle, type SyncAdapter } from '../src/shared/driveSync/engine.ts';
import type { DriveClient } from '../src/shared/driveSync/driveClient.ts';
import { CorruptRemoteDataError, mergeDocuments } from '../src/shared/driveSync/merge.ts';
import { DAY_MS, DriveSyncError, type DriveFileMeta, type SyncDocument } from '../src/shared/driveSync/types.ts';

const NOW = 1_800_000_000_000;

function bm(id: string, url: string, updatedAt: number, extra: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    url,
    title: id,
    favicon: '',
    tags: [],
    collectionId: '__unsorted__',
    createdAt: updatedAt,
    updatedAt,
    pinned: false,
    ...extra,
  };
}

function col(id: string, name: string, updatedAt: number): Collection {
  return { id, name, icon: 'folder', color: 'blue', createdAt: updatedAt, updatedAt };
}

function localState(partial: Partial<LocalSyncState> = {}): LocalSyncState {
  return {
    bookmarks: [],
    collections: [],
    settings: { ...DEFAULT_SETTINGS },
    tombstones: { bookmarks: {}, collections: {} },
    settingsMeta: { updatedAt: 0, deviceId: '' },
    origins: {},
    ...partial,
  };
}

// ─── In-memory Drive + adapter ──────────────────────────────────────────────

interface FakeFile {
  id: string;
  name: string;
  content: string;
  version: number;
  createdTime: number;
}

function fakeDrive() {
  const files: FakeFile[] = [];
  let seq = 0;
  const calls: string[] = [];
  let beforeGetVersion: ((f: FakeFile) => void) | null = null;
  const meta = (f: FakeFile): DriveFileMeta => ({ id: f.id, name: f.name, version: String(f.version) });
  const client: DriveClient = {
    async listByName(name) {
      calls.push(`list:${name}`);
      return files.filter((f) => f.name === name).sort((a, b) => a.createdTime - b.createdTime).map(meta);
    },
    async download(id) {
      calls.push(`download:${id}`);
      const f = files.find((x) => x.id === id);
      if (!f) throw new DriveSyncError('http', 'not found', { status: 404 });
      return f.content;
    },
    async getVersion(id) {
      const f = files.find((x) => x.id === id)!;
      if (beforeGetVersion) beforeGetVersion(f);
      return String(f.version);
    },
    async create(name, content) {
      calls.push(`create:${name}`);
      const f = { id: `f${++seq}`, name, content, version: 1, createdTime: seq };
      files.push(f);
      return meta(f);
    },
    async update(id, content) {
      calls.push(`update:${id}`);
      const f = files.find((x) => x.id === id)!;
      f.content = content;
      f.version++;
      return meta(f);
    },
    async remove(id) {
      calls.push(`remove:${id}`);
      const i = files.findIndex((x) => x.id === id);
      if (i >= 0) files.splice(i, 1);
    },
    async about() {
      return { email: 'test@example.com' };
    },
  };
  return {
    client,
    files,
    calls,
    put(name: string, content: string) {
      files.push({ id: `f${++seq}`, name, content, version: 1, createdTime: seq });
    },
    onBeforeGetVersion(fn: ((f: FakeFile) => void) | null) {
      beforeGetVersion = fn;
    },
  };
}

function memoryAdapter(initial: LocalSyncState, deviceId: string) {
  const box = { state: initial, backup: null as LocalSyncState | null, hookBeforeApply: null as null | (() => void) };
  const adapter: SyncAdapter = {
    fileName: SYNC_FILE_NAME,
    legacyFileNames: [LEGACY_V1_FILE_NAME],
    format: SYNC_FORMAT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    getDeviceId: async () => deviceId,
    buildLocalDoc: async () => buildLocalDoc(box.state, deviceId),
    parseRemote: parseRemoteSyncText,
    convertLegacy: (_n, text) => convertV1Text(text),
    normalize: dedupeBookmarksByUrl,
    async updateLocal(fn) {
      box.hookBeforeApply?.();
      const next = fn(buildLocalDoc(box.state, deviceId));
      if (next) box.state = applyDocToLocal(box.state, next);
    },
    async saveBackup() {
      box.backup = structuredClone(box.state);
    },
  };
  return { adapter, box };
}

const cycle = (adapter: SyncAdapter, client: DriveClient, lastSyncAt: number | null = null) =>
  runSyncCycle(adapter, client, { now: () => NOW, sleep: async () => {}, lastSyncAt });

function remoteDoc(drive: ReturnType<typeof fakeDrive>): SyncDocument {
  const f = drive.files.find((x) => x.name === SYNC_FILE_NAME)!;
  return parseRemoteSyncText(f.content);
}

// ─── v1 → v2 ────────────────────────────────────────────────────────────────

const v1Text = JSON.stringify({
  version: 1,
  exportedAt: NOW - 10 * DAY_MS,
  bookmarks: [
    bm('b1', 'https://one.example/', NOW - 20 * DAY_MS, { tags: ['A', 'a', 'x '] }),
    bm('b2', 'https://two.example/', NOW - 20 * DAY_MS),
    { id: 'evil', url: 'javascript:alert(1)', updatedAt: 1 },
  ],
  collections: [col('c1', 'Work', NOW - 30 * DAY_MS)],
  settings: { theme: 'dark', locale: 'vi', gdriveAutoSync: false, bogus: 1 },
  deletedBookmarks: { b2: NOW - 5 * DAY_MS, gone: NOW - 3 * DAY_MS },
  deletedCollections: {},
});

test('v1 → v2: bookmarks become records, deletedBookmarks become tombstones', () => {
  const doc = convertV1Text(v1Text);
  assert.equal(doc.format, SYNC_FORMAT);
  assert.equal(doc.schemaVersion, 2);
  const b = doc.entities.bookmarks;
  assert.deepEqual((b.b1.data as Bookmark).tags, ['a', 'x']);
  assert.equal(b.b2.deletedAt, NOW - 5 * DAY_MS, 'deletion newer than edit wins');
  assert.equal(b.gone.deletedAt, NOW - 3 * DAY_MS);
  assert.equal('evil' in b, false, 'unsafe URL dropped');
  assert.equal((doc.entities.collections.c1.data as Collection).name, 'Work');
  // only roaming settings are kept; per-device auto-sync is not
  assert.deepEqual(doc.settings.value, { theme: 'dark', locale: 'vi' });
  assert.equal(doc.settings.updatedAt, NOW - 10 * DAY_MS);
});

test('v1 → v2: broken v1 file is rejected', () => {
  assert.throws(() => convertV1Text('{"version":2}'), CorruptRemoteDataError);
  assert.throws(() => convertV1Text('nope'), CorruptRemoteDataError);
});

test('first sync migrates v1 into a new v2 file, merges with local, keeps the v1 file', async () => {
  const drive = fakeDrive();
  drive.put(LEGACY_V1_FILE_NAME, v1Text);
  const { adapter, box } = memoryAdapter(
    localState({ bookmarks: [bm('b3', 'https://three.example/', NOW - DAY_MS)] }),
    'dev_new'
  );
  const res = await cycle(adapter, drive.client);
  assert.equal(res.migratedFrom, LEGACY_V1_FILE_NAME);
  assert.equal(res.created, true);
  assert.ok(drive.files.some((f) => f.name === LEGACY_V1_FILE_NAME), 'v1 file is not deleted');
  assert.equal(drive.calls.filter((c) => c.startsWith('remove')).length, 0);

  const ids = box.state.bookmarks.map((b) => b.id).sort();
  assert.deepEqual(ids, ['b1', 'b3']);
  assert.equal(box.state.settings.theme, 'dark');
  assert.ok(box.backup, 'pre-merge backup saved because local changed');

  const doc = remoteDoc(drive);
  assert.ok(doc.entities.bookmarks.b3);
  assert.equal(doc.entities.bookmarks.b2.deletedAt, NOW - 5 * DAY_MS);
});

// ─── Per-record application ────────────────────────────────────────────────

test('applyDocToLocal keeps local order, removes tombstoned, adds new at the front', () => {
  const local = localState({
    bookmarks: [bm('a', 'https://a.example/', 10), bm('b', 'https://b.example/', 10), bm('c', 'https://c.example/', 10)],
  });
  const doc = buildLocalDoc(local, 'dev_a');
  doc.entities.bookmarks.b = { updatedAt: 20, deviceId: 'dev_b', deletedAt: 20, data: null };
  doc.entities.bookmarks.n = {
    updatedAt: 30,
    deviceId: 'dev_b',
    deletedAt: null,
    data: bm('n', 'https://n.example/', 30),
  };
  const weird = { ...bm('w', 'https://w.example/', 10), url: 'chrome://settings' };
  const next = applyDocToLocal({ ...local, bookmarks: [...local.bookmarks, weird] }, doc);
  // 'w' cannot be represented in the sync document (unsafe URL) and is left untouched
  assert.deepEqual(next.bookmarks.map((b) => b.id), ['n', 'a', 'c', 'w']);
  assert.deepEqual(next.tombstones.bookmarks, { b: 20 });
  assert.deepEqual(next.origins['bookmarks:n'], { u: 30, d: 'dev_b' });
});

test('records keep their origin deviceId until edited locally (no upload churn)', () => {
  const local = localState({
    bookmarks: [bm('a', 'https://a.example/', 10)],
    origins: { 'bookmarks:a': { u: 10, d: 'dev_other' } },
  });
  assert.equal(buildLocalDoc(local, 'dev_me').entities.bookmarks.a.deviceId, 'dev_other');
  local.bookmarks[0] = { ...local.bookmarks[0], updatedAt: 11 };
  assert.equal(buildLocalDoc(local, 'dev_me').entities.bookmarks.a.deviceId, 'dev_me');
});

test('a bookmark saved while the sync is in flight is not lost', async () => {
  const drive = fakeDrive();
  const remoteSeed = mergeDocuments(
    buildLocalDoc(localState({ bookmarks: [bm('r1', 'https://remote.example/', NOW - DAY_MS)] }), 'dev_b'),
    buildLocalDoc(localState(), 'dev_b'),
    { deviceId: 'dev_b', format: SYNC_FORMAT, schemaVersion: 2, now: NOW }
  ).merged;
  drive.put(SYNC_FILE_NAME, JSON.stringify(remoteSeed));

  const { adapter, box } = memoryAdapter(localState({ bookmarks: [bm('l1', 'https://local.example/', NOW - DAY_MS)] }), 'dev_a');
  // Simulates the user saving a bookmark between the snapshot and the local write.
  box.hookBeforeApply = () => {
    box.state = { ...box.state, bookmarks: [bm('during', 'https://during.example/', NOW), ...box.state.bookmarks] };
  };
  await cycle(adapter, drive.client);
  const ids = box.state.bookmarks.map((b) => b.id).sort();
  assert.deepEqual(ids, ['during', 'l1', 'r1']);
});

test('no upload and no local write when both sides already match', async () => {
  const drive = fakeDrive();
  const { adapter, box } = memoryAdapter(localState({ bookmarks: [bm('a', 'https://a.example/', NOW - DAY_MS)] }), 'dev_a');
  await cycle(adapter, drive.client); // creates file
  drive.calls.length = 0;
  const before = box.state;
  const res = await cycle(adapter, drive.client);
  assert.equal(res.changedRemote, false);
  assert.equal(res.changedLocal, false);
  assert.equal(drive.calls.some((c) => c.startsWith('update') || c.startsWith('create')), false);
  assert.equal(box.state, before);
});

test('two devices converge: edits, deletes and settings flow both ways', async () => {
  const drive = fakeDrive();
  const A = memoryAdapter(
    localState({ bookmarks: [bm('x', 'https://x.example/', NOW - 5 * DAY_MS), bm('y', 'https://y.example/', NOW - 5 * DAY_MS)] }),
    'dev_a'
  );
  const B = memoryAdapter(localState(), 'dev_b');
  await cycle(A.adapter, drive.client);
  await cycle(B.adapter, drive.client);
  assert.deepEqual(B.box.state.bookmarks.map((b) => b.id).sort(), ['x', 'y']);

  // B deletes y and changes theme; A edits x.
  B.box.state = {
    ...B.box.state,
    bookmarks: B.box.state.bookmarks.filter((b) => b.id !== 'y'),
    tombstones: { bookmarks: { y: NOW - DAY_MS }, collections: {} },
    settings: { ...B.box.state.settings, theme: 'dark' } as AppSettings,
    settingsMeta: { updatedAt: NOW - DAY_MS, deviceId: 'dev_b' },
  };
  A.box.state = {
    ...A.box.state,
    bookmarks: A.box.state.bookmarks.map((b) => (b.id === 'x' ? { ...b, title: 'edited', updatedAt: NOW - 2 * DAY_MS } : b)),
  };
  await cycle(B.adapter, drive.client);
  await cycle(A.adapter, drive.client);
  await cycle(B.adapter, drive.client);

  for (const side of [A, B]) {
    assert.deepEqual(side.box.state.bookmarks.map((b) => b.id), ['x']);
    assert.equal(side.box.state.bookmarks[0].title, 'edited');
    assert.equal(side.box.state.settings.theme, 'dark');
  }
});

// ─── Safety ────────────────────────────────────────────────────────────────

test('corrupt remote file: error thrown, local data untouched, nothing uploaded', async () => {
  const drive = fakeDrive();
  drive.put(SYNC_FILE_NAME, '{"format":"bookmark-manager-sync","schemaVersion":2,"entities":{"bookmarks":[1,2]}}');
  const initial = localState({ bookmarks: [bm('a', 'https://a.example/', NOW)] });
  const { adapter, box } = memoryAdapter(initial, 'dev_a');
  await assert.rejects(() => cycle(adapter, drive.client), CorruptRemoteDataError);
  assert.equal(box.state, initial);
  assert.equal(drive.calls.some((c) => c.startsWith('update') || c.startsWith('create')), false);
});

test('newer schema on Drive is never overwritten', async () => {
  const drive = fakeDrive();
  drive.put(SYNC_FILE_NAME, JSON.stringify({ format: SYNC_FORMAT, schemaVersion: 3, entities: {} }));
  const { adapter } = memoryAdapter(localState({ bookmarks: [bm('a', 'https://a.example/', NOW)] }), 'dev_a');
  await assert.rejects(() => cycle(adapter, drive.client), (e: unknown) => e instanceof DriveSyncError && e.code === 'schema_too_new');
  assert.equal(drive.calls.some((c) => c.startsWith('update')), false);
});

test('version changed before PATCH → merge again (up to 3 rounds)', async () => {
  const drive = fakeDrive();
  const { adapter: seedAdapter } = memoryAdapter(localState({ bookmarks: [bm('s', 'https://s.example/', NOW - DAY_MS)] }), 'dev_s');
  await cycle(seedAdapter, drive.client);

  let bumps = 0;
  drive.onBeforeGetVersion((f) => {
    if (bumps++ === 0) {
      // another device writes a new bookmark right before our PATCH
      const doc = JSON.parse(f.content);
      doc.entities.bookmarks.other = {
        updatedAt: NOW,
        deviceId: 'dev_o',
        deletedAt: null,
        data: bm('other', 'https://other.example/', NOW),
      };
      f.content = JSON.stringify(doc);
      f.version++;
    }
  });
  const { adapter, box } = memoryAdapter(localState({ bookmarks: [bm('mine', 'https://mine.example/', NOW)] }), 'dev_a');
  const res = await cycle(adapter, drive.client);
  assert.equal(res.rounds, 2);
  const remote = remoteDoc(drive);
  assert.deepEqual(Object.keys(remote.entities.bookmarks).sort(), ['mine', 'other', 's']);
  assert.deepEqual(box.state.bookmarks.map((b) => b.id).sort(), ['mine', 'other', 's']);
});

test('version keeps changing → conflict error after 3 rounds, no blind overwrite', async () => {
  const drive = fakeDrive();
  const { adapter: seed } = memoryAdapter(localState({ bookmarks: [bm('s', 'https://s.example/', NOW - DAY_MS)] }), 'dev_s');
  await cycle(seed, drive.client);
  drive.onBeforeGetVersion((f) => {
    f.version++;
  });
  drive.calls.length = 0;
  const { adapter } = memoryAdapter(localState({ bookmarks: [bm('m', 'https://m.example/', NOW)] }), 'dev_a');
  await assert.rejects(() => cycle(adapter, drive.client), (e: unknown) => e instanceof DriveSyncError && e.code === 'conflict');
  assert.equal(drive.calls.some((c) => c.startsWith('update')), false);
});

test('duplicate URLs across devices collapse into one, loser gets a tombstone', async () => {
  const drive = fakeDrive();
  const A = memoryAdapter(localState({ bookmarks: [bm('a1', 'https://dup.example/page', NOW - 2 * DAY_MS, { tags: ['x'] })] }), 'dev_a');
  const B = memoryAdapter(localState({ bookmarks: [bm('b1', 'https://dup.example/page/', NOW - DAY_MS, { tags: ['y'] })] }), 'dev_b');
  await cycle(A.adapter, drive.client);
  await cycle(B.adapter, drive.client);
  assert.equal(B.box.state.bookmarks.length, 1);
  assert.deepEqual([...B.box.state.bookmarks[0].tags].sort(), ['x', 'y']);
  const remote = remoteDoc(drive);
  const tombs = Object.values(remote.entities.bookmarks).filter((r) => r.deletedAt !== null);
  assert.equal(tombs.length, 1);
  await cycle(A.adapter, drive.client);
  assert.equal(A.box.state.bookmarks.length, 1);
});

test('device offline > 180 days does not resurrect bookmarks deleted elsewhere', async () => {
  const drive = fakeDrive();
  const lastSyncAt = NOW - 200 * DAY_MS;
  // Remote no longer knows "old" (deleted long ago, tombstone already pruned).
  const { adapter: seed } = memoryAdapter(localState({ bookmarks: [bm('keep', 'https://keep.example/', NOW - 300 * DAY_MS)] }), 'dev_s');
  await cycle(seed, drive.client);
  const { adapter, box } = memoryAdapter(
    localState({
      bookmarks: [
        bm('keep', 'https://keep.example/', NOW - 300 * DAY_MS),
        bm('old', 'https://old.example/', NOW - 250 * DAY_MS),
        bm('fresh', 'https://fresh.example/', NOW - DAY_MS),
      ],
    }),
    'dev_a'
  );
  await cycle(adapter, drive.client, lastSyncAt);
  assert.deepEqual(box.state.bookmarks.map((b) => b.id).sort(), ['fresh', 'keep']);
  assert.equal('old' in remoteDoc(drive).entities.bookmarks, false);
});
