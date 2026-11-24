/**
 * Shared Google Drive sync module — sync engine (app-agnostic).
 *
 * One cycle = list → download → validate → merge (LWW per record) → upload only if the
 * remote changed (compare-then-write on files.version) → apply to local per record
 * (re-reading local right before writing) only if local changed.
 *
 * Scheduling: startup, periodic alarm, debounced after local changes, manual.
 * Singleflight: concurrent requests share the running cycle; a request arriving during a
 * run marks `pending` and exactly one more cycle runs afterwards.
 */
import {
  CorruptRemoteDataError,
  documentContentEqual,
  mergeDocuments,
} from './merge.ts';
import type { DriveClient } from './driveClient.ts';
import {
  DEFAULT_DRIVE_SYNC_STATE,
  DriveSyncError,
  TOMBSTONE_RETENTION_MS,
  toDriveErrorInfo,
  type DriveErrorInfo,
  type DriveSyncState,
  type SyncDocument,
} from './types.ts';

// ─── Adapter contract (implemented per app) ─────────────────────────────────

export interface SyncAdapter {
  /** Current file name in appDataFolder, e.g. "bookmark-manager-sync-v2.json" */
  fileName: string;
  /** Older file names to import from once when `fileName` does not exist yet (never deleted). */
  legacyFileNames?: string[];
  format: string;
  schemaVersion: number;
  getDeviceId(): Promise<string>;
  /** Snapshot of local data as a sync document. */
  buildLocalDoc(): Promise<SyncDocument>;
  /** Parse + strictly validate remote JSON. Throw CorruptRemoteDataError on bad data. */
  parseRemote(text: string): SyncDocument;
  /** Convert a legacy file to the current document shape. Throw CorruptRemoteDataError on bad data. */
  convertLegacy?(fileName: string, text: string): SyncDocument;
  /** Optional app-level cleanup after merging (e.g. de-duplicate by URL). Must be deterministic. */
  normalize?(doc: SyncDocument, ctx: { deviceId: string; now: number }): SyncDocument;
  /**
   * Atomically apply a change to local data: read the freshest local doc, call `fn`,
   * and persist its result per record. `fn` returns null when nothing needs writing.
   * No awaits may happen between reading local data and handing it to `fn` / committing.
   */
  updateLocal(fn: (fresh: SyncDocument) => SyncDocument | null): Promise<void>;
  /** Keep one pre-merge snapshot of local data so the user can download it. */
  saveBackup(local: SyncDocument, savedAt: number): Promise<void>;
}

// ─── One sync cycle (pure orchestration, testable with a fake DriveClient) ──

export interface CycleOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Last successful sync of this device; drives the stale-device guard. */
  lastSyncAt?: number | null;
  retentionMs?: number;
  maxRounds?: number;
}

export interface CycleResult {
  changedLocal: boolean;
  changedRemote: boolean;
  created: boolean;
  migratedFrom: string | null;
  backupAt: number | null;
  rounds: number;
}

export async function runSyncCycle(
  adapter: SyncAdapter,
  client: DriveClient,
  opts: CycleOptions = {}
): Promise<CycleResult> {
  const nowFn = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retentionMs = opts.retentionMs ?? TOMBSTONE_RETENTION_MS;
  const maxRounds = opts.maxRounds ?? 3;

  for (let round = 1; round <= maxRounds; round++) {
    const now = nowFn();
    const deviceId = await adapter.getDeviceId();
    const mergeOpts = {
      deviceId,
      now,
      retentionMs,
      format: adapter.format,
      schemaVersion: adapter.schemaVersion,
    };

    const files = await client.listByName(adapter.fileName);
    const primary = files[0] ?? null;
    let remote: SyncDocument | null = null;
    let baseVersion: string | null = null;
    let migratedFrom: string | null = null;
    const extrasToDelete: string[] = [];

    if (primary) {
      baseVersion = primary.version ?? null;
      remote = adapter.parseRemote(await client.download(primary.id));
      // Two devices racing on first sync can create duplicates: fold them into the oldest.
      for (const extra of files.slice(1)) {
        try {
          const doc = adapter.parseRemote(await client.download(extra.id));
          remote = mergeDocuments(remote, doc, mergeOpts).merged;
          extrasToDelete.push(extra.id);
        } catch (err) {
          if (!(err instanceof CorruptRemoteDataError)) throw err;
          // leave a corrupt duplicate untouched
        }
      }
    } else if (adapter.legacyFileNames && adapter.convertLegacy) {
      for (const name of adapter.legacyFileNames) {
        const legacy = (await client.listByName(name))[0];
        if (!legacy) continue;
        remote = adapter.convertLegacy(name, await client.download(legacy.id));
        migratedFrom = name;
        break;
      }
    }

    const local = await adapter.buildLocalDoc();
    const lastSyncAt = opts.lastSyncAt ?? null;
    const staleBefore =
      primary && lastSyncAt && now - lastSyncAt > retentionMs ? lastSyncAt : undefined;

    let final: SyncDocument = remote
      ? mergeDocuments(local, remote, { ...mergeOpts, staleBefore }).merged
      : { ...local, format: adapter.format, schemaVersion: adapter.schemaVersion, updatedAt: now, lastDeviceId: deviceId };
    if (adapter.normalize) final = adapter.normalize(final, { deviceId, now });

    const changedLocal = !documentContentEqual(final, local);
    const changedRemote =
      !primary ||
      !remote ||
      remote.schemaVersion < adapter.schemaVersion ||
      extrasToDelete.length > 0 ||
      !documentContentEqual(final, remote);

    let backupAt: number | null = null;
    if (changedLocal) {
      await adapter.saveBackup(local, now);
      backupAt = now;
    }

    let created = false;
    if (changedRemote) {
      const body = JSON.stringify(final);
      if (primary) {
        // Compare-then-write: Drive v3 ignores If-Match, so check files.version ourselves.
        const current = await client.getVersion(primary.id);
        if (baseVersion !== null && current !== null && current !== baseVersion) {
          if (round < maxRounds) {
            await sleep(300 * round);
            continue;
          }
          throw new DriveSyncError('conflict', 'Drive file kept changing during sync.');
        }
        await client.update(primary.id, body);
      } else {
        await client.create(adapter.fileName, body);
        created = true;
      }
    }

    if (changedLocal) {
      await adapter.updateLocal((fresh) => {
        // Second LWW pass against the freshest local data: edits made while we were
        // talking to Drive carry newer timestamps and survive.
        const res = mergeDocuments(fresh, final, { ...mergeOpts, staleBefore });
        return res.changedLocal ? res.merged : null;
      });
    }

    for (const id of extrasToDelete) {
      await client.remove(id).catch(() => undefined);
    }

    return { changedLocal, changedRemote, created, migratedFrom, backupAt, rounds: round };
  }
  throw new DriveSyncError('conflict', 'Drive file kept changing during sync.');
}


// ─── Engine: state, singleflight, scheduling ────────────────────────────────

export interface EngineConfig {
  adapter: SyncAdapter;
  client: DriveClient;
  /** chrome.storage.local key holding DriveSyncState */
  stateKey: string;
  isConfigured: () => boolean;
  /** Interactive sign-in (account chooser). */
  signInInteractive: () => Promise<void>;
  /** Make sure a token can be obtained silently; throw DriveSyncError('needs_reauth') if not. */
  ensureToken: () => Promise<void>;
  /** Revoke + forget the token. */
  revoke: () => Promise<void>;
  isAutoSyncEnabled: () => Promise<boolean>;
  alarms: {
    periodic: string;
    debounce: string;
    retry: string;
    periodMinutes: number;
  };
  debounceMs?: number;
  now?: () => number;
}

export interface SyncOutcome {
  ok: boolean;
  skipped?: boolean;
  state: DriveSyncState;
  error?: DriveErrorInfo;
  changedLocal?: boolean;
}

export interface SyncEngine {
  getState(): Promise<DriveSyncState>;
  sync(opts?: { manual?: boolean }): Promise<SyncOutcome>;
  signIn(): Promise<SyncOutcome>;
  signOut(): Promise<DriveSyncState>;
  deleteRemoteData(): Promise<SyncOutcome>;
  notifyLocalChange(): void;
  handleAlarm(name: string): Promise<boolean>;
  handleStartup(): Promise<void>;
  refreshSchedule(): Promise<void>;
  isBusy(): boolean;
}

export function createSyncEngine(cfg: EngineConfig): SyncEngine {
  const now = cfg.now ?? Date.now;
  const debounceMs = cfg.debounceMs ?? 5_000;
  let active: Promise<SyncOutcome> | null = null;
  let pending = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadState(): Promise<DriveSyncState> {
    const res = await chrome.storage.local.get(cfg.stateKey);
    const raw = res[cfg.stateKey] as Partial<DriveSyncState> | undefined;
    const st: DriveSyncState = { ...DEFAULT_DRIVE_SYNC_STATE, ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!cfg.isConfigured()) return { ...st, status: 'unconfigured' };
    if (!st.signedIn) return { ...st, status: 'signed_out' };
    if (st.status === 'syncing' && !active) {
      // The worker died mid-sync; don't show a spinner forever.
      return { ...st, status: st.lastError ? 'error' : st.lastSyncAt ? 'synced' : 'idle' };
    }
    if (st.status === 'unconfigured' || st.status === 'signed_out') return { ...st, status: 'idle' };
    return st;
  }

  async function saveState(patch: Partial<DriveSyncState>): Promise<DriveSyncState> {
    const current = await loadState();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [cfg.stateKey]: next });
    return next;
  }

  async function clearAlarms(names: string[]) {
    for (const n of names) await chrome.alarms.clear(n).catch(() => false);
  }

  async function shouldAutoSync(st: DriveSyncState): Promise<boolean> {
    return cfg.isConfigured() && st.signedIn && st.status !== 'needs_reauth' && (await cfg.isAutoSyncEnabled());
  }

  async function refreshSchedule(): Promise<void> {
    const st = await loadState();
    if (await shouldAutoSync(st)) {
      const existing = await chrome.alarms.get(cfg.alarms.periodic).catch(() => undefined);
      if (!existing || existing.periodInMinutes !== cfg.alarms.periodMinutes) {
        await chrome.alarms.create(cfg.alarms.periodic, { periodInMinutes: cfg.alarms.periodMinutes });
      }
    } else {
      await clearAlarms([cfg.alarms.periodic, cfg.alarms.debounce, cfg.alarms.retry]);
    }
  }

  function isOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  async function runOnce(manual: boolean): Promise<SyncOutcome> {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await clearAlarms([cfg.alarms.debounce]);
    const before = await loadState();
    await saveState({ status: 'syncing', lastAttemptAt: now() });
    try {
      await cfg.ensureToken();
      let account = before.account;
      if (!account) account = await cfg.client.about();
      const res = await runSyncCycle(cfg.adapter, cfg.client, {
        now,
        lastSyncAt: before.lastSyncAt,
      });
      await clearAlarms([cfg.alarms.retry]);
      const state = await saveState({
        status: 'synced',
        account: account ?? before.account,
        lastSyncAt: now(),
        lastError: null,
        failureCount: 0,
        ...(res.backupAt ? { backupAt: res.backupAt } : {}),
        ...(res.migratedFrom ? { migratedFrom: res.migratedFrom } : {}),
      });
      return { ok: true, state, changedLocal: res.changedLocal };
    } catch (err) {
      const info = toDriveErrorInfo(err, now());
      const retryable = err instanceof DriveSyncError && err.retryable;
      const failureCount = retryable ? before.failureCount + 1 : before.failureCount;
      const state = await saveState({
        status: info.code === 'needs_reauth' ? 'needs_reauth' : 'error',
        lastError: info,
        failureCount,
      });
      if (retryable && (await cfg.isAutoSyncEnabled())) {
        const delayMinutes = Math.min(60, 2 ** Math.min(failureCount, 6));
        await chrome.alarms.create(cfg.alarms.retry, { delayInMinutes: delayMinutes });
      }
      if (info.code === 'needs_reauth') await refreshSchedule();
      return { ok: false, state, error: info };
    }
  }

  async function sync(opts: { manual?: boolean } = {}): Promise<SyncOutcome> {
    const manual = Boolean(opts.manual);
    const st = await loadState();
    if (!cfg.isConfigured() || !st.signedIn) {
      return { ok: false, skipped: true, state: st };
    }
    if (!manual && !(await shouldAutoSync(st))) {
      return { ok: false, skipped: true, state: st };
    }
    if (isOffline()) {
      if (!manual) return { ok: false, skipped: true, state: st };
      const info: DriveErrorInfo = { code: 'offline', at: now() };
      return { ok: false, state: await saveState({ lastError: info, status: 'error' }), error: info };
    }
    if (active) {
      pending = true;
      return active;
    }
    active = (async () => {
      try {
        let out: SyncOutcome;
        do {
          pending = false;
          out = await runOnce(manual);
        } while (pending && out.ok);
        return out;
      } finally {
        active = null;
      }
    })();
    return active;
  }

  async function signIn(): Promise<SyncOutcome> {
    if (!cfg.isConfigured()) {
      const info: DriveErrorInfo = { code: 'not_configured', at: now() };
      return { ok: false, state: await loadState(), error: info };
    }
    try {
      await cfg.signInInteractive();
    } catch (err) {
      const info = toDriveErrorInfo(err, now());
      const st = await loadState();
      // Cancelling a re-login keeps the "needs re-auth" state; otherwise show the error.
      const state = await saveState({
        lastError: info,
        status: st.signedIn ? (st.status === 'needs_reauth' ? 'needs_reauth' : 'error') : 'signed_out',
      });
      return { ok: false, state, error: info };
    }
    const account = await cfg.client.about().catch(() => null);
    await saveState({ signedIn: true, status: 'idle', account, lastError: null, failureCount: 0 });
    await refreshSchedule();
    return sync({ manual: true });
  }

  async function signOut(): Promise<DriveSyncState> {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    await cfg.revoke().catch(() => undefined);
    await clearAlarms([cfg.alarms.periodic, cfg.alarms.debounce, cfg.alarms.retry]);
    const prev = await loadState();
    await chrome.storage.local.set({
      [cfg.stateKey]: { ...DEFAULT_DRIVE_SYNC_STATE, backupAt: prev.backupAt },
    });
    return loadState();
  }

  async function deleteRemoteData(): Promise<SyncOutcome> {
    const st = await loadState();
    if (!st.signedIn) return { ok: false, state: st };
    try {
      if (active) await active.catch(() => undefined);
      await cfg.ensureToken();
      const names = [cfg.adapter.fileName, ...(cfg.adapter.legacyFileNames ?? [])];
      for (const name of names) {
        for (const f of await cfg.client.listByName(name)) await cfg.client.remove(f.id);
      }
    } catch (err) {
      const info = toDriveErrorInfo(err, now());
      const state = await saveState({
        lastError: info,
        status: info.code === 'needs_reauth' ? 'needs_reauth' : 'error',
      });
      return { ok: false, state, error: info };
    }
    return { ok: true, state: await signOut() };
  }

  function notifyLocalChange(): void {
    void (async () => {
      const st = await loadState();
      if (!(await shouldAutoSync(st))) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void sync();
      }, debounceMs);
      // Backup in case the service worker is suspended before the timer fires
      // (Chrome clamps alarms to >= 30 s).
      await chrome.alarms.create(cfg.alarms.debounce, { delayInMinutes: 0.5 });
    })().catch(() => undefined);
  }

  async function handleAlarm(name: string): Promise<boolean> {
    if (name !== cfg.alarms.periodic && name !== cfg.alarms.debounce && name !== cfg.alarms.retry) {
      return false;
    }
    await sync();
    return true;
  }

  async function handleStartup(): Promise<void> {
    await refreshSchedule();
    await sync();
  }

  return {
    getState: loadState,
    sync,
    signIn,
    signOut,
    deleteRemoteData,
    notifyLocalChange,
    handleAlarm,
    handleStartup,
    refreshSchedule,
    isBusy: () => active !== null,
  };
}
