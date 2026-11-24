import assert from 'node:assert/strict';
import test from 'node:test';
import {
  documentContentEqual,
  emptyDocument,
  mergeDocuments,
  mergeRecordMaps,
  parseRemoteDocument,
  pickWinner,
  pruneTombstones,
  CorruptRemoteDataError,
} from '../src/shared/driveSync/merge.ts';
import { DAY_MS, DriveSyncError, TOMBSTONE_RETENTION_MS, type RecordMap, type SyncRecord } from '../src/shared/driveSync/types.ts';

const live = <T>(data: T, updatedAt: number, deviceId = 'dev_a'): SyncRecord<T> => ({
  updatedAt,
  deviceId,
  deletedAt: null,
  data,
});
const tomb = (at: number, deviceId = 'dev_a'): SyncRecord<never> => ({
  updatedAt: at,
  deviceId,
  deletedAt: at,
  data: null,
});

const NOW = 1_800_000_000_000;

test('LWW: newer updatedAt wins on either side', () => {
  const local: RecordMap = { x: live({ v: 'local' }, 200) };
  const remote: RecordMap = { x: live({ v: 'remote' }, 100) };
  const res = mergeRecordMaps(local, remote, { now: NOW });
  assert.deepEqual(res.merged.x.data, { v: 'local' });
  assert.equal(res.changedLocal, false);
  assert.equal(res.changedRemote, true);

  const res2 = mergeRecordMaps(remote, local, { now: NOW });
  assert.deepEqual(res2.merged.x.data, { v: 'local' });
  assert.equal(res2.changedLocal, true);
  assert.equal(res2.changedRemote, false);
});

test('tie on updatedAt: higher deviceId wins, deterministically on both devices', () => {
  const a = live({ v: 'A' }, 100, 'dev_a');
  const b = live({ v: 'B' }, 100, 'dev_b');
  assert.equal(pickWinner(a, b), 'remote');
  assert.equal(pickWinner(b, a), 'local');
  const onA = mergeRecordMaps({ x: a }, { x: b }, { now: NOW }).merged.x;
  const onB = mergeRecordMaps({ x: b }, { x: a }, { now: NOW }).merged.x;
  assert.deepEqual(onA, onB);
  assert.equal(onA.deviceId, 'dev_b');
});

test('full tie (same updatedAt + deviceId, different content) still converges', () => {
  const a = live({ v: 'aaa' }, 100, 'dev_a');
  const b = live({ v: 'zzz' }, 100, 'dev_a');
  const onA = mergeRecordMaps({ x: a }, { x: b }, { now: NOW }).merged.x;
  const onB = mergeRecordMaps({ x: b }, { x: a }, { now: NOW }).merged.x;
  assert.deepEqual(onA, onB);
});

test('identical maps → nothing changed on either side', () => {
  const map: RecordMap = { x: live({ v: 1 }, 100), y: tomb(NOW - DAY_MS) };
  const res = mergeRecordMaps(map, structuredClone(map), { now: NOW });
  assert.equal(res.changedLocal, false);
  assert.equal(res.changedRemote, false);
});

test('tombstone newer than the edit deletes; edit newer than tombstone revives', () => {
  const t = NOW - DAY_MS;
  const deletedLater = mergeRecordMaps({ x: live({ v: 1 }, t - 100) }, { x: tomb(t) }, { now: NOW });
  assert.equal(deletedLater.merged.x.deletedAt, t);
  assert.equal(deletedLater.changedLocal, true);

  const editedLater = mergeRecordMaps({ x: live({ v: 2 }, t + 100) }, { x: tomb(t) }, { now: NOW });
  assert.equal(editedLater.merged.x.deletedAt, null);
  assert.deepEqual(editedLater.merged.x.data, { v: 2 });
  assert.equal(editedLater.changedRemote, true);
});

test('tombstones are pruned after 180 days, younger ones are kept', () => {
  assert.equal(TOMBSTONE_RETENTION_MS, 180 * DAY_MS);
  const map: RecordMap = {
    old: tomb(NOW - 181 * DAY_MS),
    young: tomb(NOW - 179 * DAY_MS),
    alive: live({ v: 1 }, NOW - 400 * DAY_MS),
  };
  const pruned = pruneTombstones(map, NOW);
  assert.deepEqual(Object.keys(pruned).sort(), ['alive', 'young']);

  const res = mergeRecordMaps(map, {}, { now: NOW });
  assert.equal('old' in res.merged, false);
  assert.equal('alive' in res.merged, true);
});

test('stale device guard: local-only records untouched since last sync are not resurrected', () => {
  const lastSyncAt = NOW - 200 * DAY_MS;
  const local: RecordMap = {
    deletedElsewhere: live({ v: 'stale' }, lastSyncAt - DAY_MS),
    newHere: live({ v: 'new' }, NOW - DAY_MS),
  };
  const res = mergeRecordMaps(local, {}, { now: NOW, staleBefore: lastSyncAt });
  assert.equal('deletedElsewhere' in res.merged, false);
  assert.equal('newHere' in res.merged, true);
});

test('mergeDocuments merges settings register LWW and reports flags', () => {
  const local = emptyDocument('fmt', 2);
  local.settings = { value: { theme: 'dark' }, updatedAt: 500, deviceId: 'dev_a' };
  local.entities.items = { a: live({ n: 1 }, 10) };
  const remote = emptyDocument('fmt', 2);
  remote.settings = { value: { theme: 'light' }, updatedAt: 900, deviceId: 'dev_b' };
  remote.entities.items = { b: live({ n: 2 }, 20) };

  const res = mergeDocuments(local, remote, { deviceId: 'dev_a', format: 'fmt', schemaVersion: 2, now: NOW });
  assert.deepEqual(res.merged.settings.value, { theme: 'light' });
  assert.deepEqual(Object.keys(res.merged.entities.items).sort(), ['a', 'b']);
  assert.equal(res.changedLocal, true);
  assert.equal(res.changedRemote, true);
  assert.equal(res.merged.lastDeviceId, 'dev_a');
  // envelope-only differences do not count as content changes
  assert.equal(documentContentEqual(res.merged, { ...res.merged, updatedAt: 1, lastDeviceId: 'x' }), true);
});

test('merge is idempotent: merging the result again changes nothing', () => {
  const local = emptyDocument('fmt', 2);
  local.entities.items = { a: live({ n: 1 }, 10), c: tomb(NOW - DAY_MS) };
  const remote = emptyDocument('fmt', 2);
  remote.entities.items = { a: live({ n: 9 }, 5), b: live({ n: 2 }, 20) };
  const opts = { deviceId: 'dev_a', format: 'fmt', schemaVersion: 2, now: NOW };
  const first = mergeDocuments(local, remote, opts).merged;
  const second = mergeDocuments(first, remote, opts);
  assert.equal(second.changedLocal, false);
  const third = mergeDocuments(first, first, opts);
  assert.equal(third.changedLocal || third.changedRemote, false);
});

const schema = {
  format: 'fmt',
  schemaVersion: 2,
  sanitizers: {
    items: (_id: string, data: unknown) =>
      data && typeof data === 'object' && typeof (data as { n?: unknown }).n === 'number' ? data : null,
  },
};

test('parseRemoteDocument rejects broken JSON / structure with CorruptRemoteDataError', () => {
  assert.throws(() => parseRemoteDocument('', schema), CorruptRemoteDataError);
  assert.throws(() => parseRemoteDocument('{nope', schema), CorruptRemoteDataError);
  assert.throws(() => parseRemoteDocument('[]', schema), CorruptRemoteDataError);
  assert.throws(
    () => parseRemoteDocument(JSON.stringify({ format: 'other', schemaVersion: 2, entities: {} }), schema),
    CorruptRemoteDataError
  );
  assert.throws(
    () =>
      parseRemoteDocument(
        JSON.stringify({ format: 'fmt', schemaVersion: 2, entities: { items: { a: { updatedAt: 'x' } } } }),
        schema
      ),
    CorruptRemoteDataError
  );
});

test('parseRemoteDocument refuses a newer schema without calling it corrupt', () => {
  try {
    parseRemoteDocument(JSON.stringify({ format: 'fmt', schemaVersion: 3, entities: {} }), schema);
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof DriveSyncError);
    assert.equal((err as DriveSyncError).code, 'schema_too_new');
  }
});

test('parseRemoteDocument skips records whose data fails the sanitizer, keeps tombstones', () => {
  const doc = parseRemoteDocument(
    JSON.stringify({
      format: 'fmt',
      schemaVersion: 2,
      entities: {
        items: {
          good: { updatedAt: 1, deviceId: 'd', deletedAt: null, data: { n: 1 } },
          bad: { updatedAt: 1, deviceId: 'd', deletedAt: null, data: { n: 'x' } },
          gone: { updatedAt: 2, deviceId: 'd', deletedAt: 2, data: null },
        },
      },
      settings: { value: { a: 1 }, updatedAt: 5, deviceId: 'd' },
    }),
    schema
  );
  assert.deepEqual(Object.keys(doc.entities.items).sort(), ['gone', 'good']);
  assert.equal(doc.entities.items.gone.deletedAt, 2);
  assert.equal(doc.settings.updatedAt, 5);
});
