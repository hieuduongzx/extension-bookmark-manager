import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthUrl, classifyAuthError, DRIVE_APPDATA_SCOPE, type AuthConfig } from '../src/shared/driveSync/auth.ts';
import { createSyncEngine, type SyncAdapter } from '../src/shared/driveSync/engine.ts';
import type { DriveClient } from '../src/shared/driveSync/driveClient.ts';
import { DriveSyncError, type DriveSyncState } from '../src/shared/driveSync/types.ts';

const CFG: AuthConfig = {
  clientId: '123-abc.apps.googleusercontent.com',
  scopes: [DRIVE_APPDATA_SCOPE],
  tokenStorageKey: 'tok',
};
const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';

// ─── Auth URL ──────────────────────────────────────────────────────────────

test('silent auth URL carries prompt=none and login_hint', () => {
  const url = new URL(buildAuthUrl(CFG, false, REDIRECT, 'me@example.com'));
  assert.equal(url.searchParams.get('prompt'), 'none');
  assert.equal(url.searchParams.get('login_hint'), 'me@example.com');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('scope'), DRIVE_APPDATA_SCOPE);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
});

test('interactive auth URL keeps select_account and adds login_hint when known', () => {
  const url = new URL(buildAuthUrl(CFG, true, REDIRECT, ' me@example.com '));
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('login_hint'), 'me@example.com');
});

test('no login_hint parameter when the account is unknown', () => {
  for (const hint of [undefined, null, '', '  ']) {
    const url = new URL(buildAuthUrl(CFG, false, REDIRECT, hint));
    assert.equal(url.searchParams.has('login_hint'), false);
  }
});

// ─── Error classification ──────────────────────────────────────────────────

test('silent "needs a user" errors map to needs_reauth', () => {
  for (const raw of [
    'interaction_required',
    'Google OAuth từ chối đăng nhập (interaction_required).',
    'login_required',
    'consent_required: Consent required',
    'account_selection_required',
    'User interaction required.',
    'Authorization page could not be loaded.',
    'access_denied',
  ]) {
    assert.equal(classifyAuthError(raw, false), 'needs_reauth', raw);
  }
});

test('configuration errors are reported as such, silent or not', () => {
  for (const interactive of [true, false]) {
    assert.equal(classifyAuthError('Error 400: redirect_uri_mismatch', interactive), 'redirect_uri_mismatch');
    assert.equal(classifyAuthError('invalid_client', interactive), 'invalid_client');
    assert.equal(classifyAuthError('Bad client id: x', interactive), 'invalid_client');
  }
});

test('interactive errors: cancelled / access_denied / unknown', () => {
  assert.equal(classifyAuthError('The user did not approve access.', true), 'cancelled');
  assert.equal(classifyAuthError('access_denied', true), 'access_denied');
  assert.equal(classifyAuthError('something odd', true), 'auth_failed');
});

// ─── Engine: needs_reauth stops automatic retries ───────────────────────────

function installChromeStub() {
  const store: Record<string, unknown> = {};
  const alarms = new Map<string, { name: string; periodInMinutes?: number; delayInMinutes?: number }>();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string | string[]) {
          const keys = Array.isArray(key) ? key : [key];
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = structuredClone(store[k]);
          return out;
        },
        async set(items: Record<string, unknown>) {
          Object.assign(store, structuredClone(items));
        },
        async remove(key: string | string[]) {
          for (const k of Array.isArray(key) ? key : [key]) delete store[k];
        },
      },
    },
    alarms: {
      async create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }) {
        alarms.set(name, { name, ...info });
      },
      async clear(name: string) {
        return alarms.delete(name);
      },
      async get(name: string) {
        return alarms.get(name);
      },
    },
  };
  return { store, alarms };
}

const dummyClient: DriveClient = {
  listByName: async () => [],
  download: async () => '',
  getVersion: async () => null,
  create: async () => ({ id: 'x' }),
  update: async () => ({ id: 'x' }),
  remove: async () => undefined,
  about: async () => ({ email: 'me@example.com' }),
};

const dummyAdapter = {} as SyncAdapter;
const ALARMS = { periodic: 'p', debounce: 'd', retry: 'r', periodMinutes: 15 };

test('silent token failure → needs_reauth, no retry alarm, auto-sync paused until sign-in', async () => {
  const { store, alarms } = installChromeStub();
  store.state = {
    status: 'synced',
    signedIn: true,
    account: { email: 'me@example.com' },
    lastSyncAt: 1,
    lastAttemptAt: 1,
    lastError: null,
    backupAt: null,
    failureCount: 0,
    migratedFrom: null,
  } satisfies DriveSyncState;
  await (globalThis as unknown as { chrome: { alarms: { create: (n: string, i: object) => Promise<void> } } }).chrome.alarms.create('p', { periodInMinutes: 15 });

  let tokenCalls = 0;
  const remembered: (string | undefined)[] = [];
  const engine = createSyncEngine({
    adapter: dummyAdapter,
    client: dummyClient,
    stateKey: 'state',
    isConfigured: () => true,
    signInInteractive: async () => undefined,
    ensureToken: async () => {
      tokenCalls++;
      throw new DriveSyncError('needs_reauth', 'interaction_required');
    },
    revoke: async () => undefined,
    rememberAccount: async (a) => {
      remembered.push(a?.email);
    },
    isAutoSyncEnabled: async () => true,
    alarms: ALARMS,
  });

  const out = await engine.sync();
  assert.equal(out.ok, false);
  assert.equal(out.state.status, 'needs_reauth');
  assert.equal(out.error?.code, 'needs_reauth');
  assert.equal(out.state.failureCount, 0);
  assert.equal(alarms.has('r'), false, 'no retry alarm for needs_reauth');
  assert.equal(alarms.has('p'), false, 'periodic alarm paused');
  assert.deepEqual(remembered, ['me@example.com'], 'login hint primed before the silent request');

  // Alarms / debounced syncs no longer hit Google until the user signs in again.
  assert.equal(await engine.handleAlarm('p'), true);
  const again = await engine.sync();
  assert.equal(again.skipped, true);
  assert.equal(tokenCalls, 1);
});

test('network error keeps status error and schedules a retry (contrast)', async () => {
  const { store, alarms } = installChromeStub();
  store.state = { status: 'synced', signedIn: true, account: { email: 'me@example.com' }, lastSyncAt: 1, failureCount: 0 };
  const engine = createSyncEngine({
    adapter: dummyAdapter,
    client: dummyClient,
    stateKey: 'state',
    isConfigured: () => true,
    signInInteractive: async () => undefined,
    ensureToken: async () => {
      throw new DriveSyncError('network', 'offline-ish');
    },
    revoke: async () => undefined,
    isAutoSyncEnabled: async () => true,
    alarms: ALARMS,
  });
  const out = await engine.sync();
  assert.equal(out.state.status, 'error');
  assert.equal(out.state.failureCount, 1);
  assert.equal(alarms.has('r'), true);
});

test('interactive sign-in remembers the chosen account and clears needs_reauth', async () => {
  const { store } = installChromeStub();
  store.state = { status: 'needs_reauth', signedIn: true, account: { email: 'old@example.com' }, failureCount: 0 };
  const remembered: (string | undefined)[] = [];
  const engine = createSyncEngine({
    adapter: dummyAdapter,
    client: { ...dummyClient, about: async () => ({ email: 'new@example.com' }) },
    stateKey: 'state',
    isConfigured: () => true,
    signInInteractive: async () => undefined,
    ensureToken: async () => {
      throw new DriveSyncError('network', 'stop the cycle here');
    },
    revoke: async () => undefined,
    rememberAccount: async (a) => {
      remembered.push(a?.email);
    },
    isAutoSyncEnabled: async () => false,
    alarms: ALARMS,
  });
  const out = await engine.signIn();
  assert.equal(remembered[0], 'new@example.com');
  assert.equal(out.state.account?.email, 'new@example.com');
  assert.notEqual(out.state.status, 'needs_reauth');
});
