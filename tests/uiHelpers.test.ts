import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDriveDotTone } from '../src/uiHelpers';
import { createT } from '../src/i18n';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

test('resolveDriveDotTone maps all Drive sync UI states accurately', () => {
  assert.equal(resolveDriveDotTone(null), 'is-muted');
  assert.equal(resolveDriveDotTone(undefined), 'is-muted');
  assert.equal(
    resolveDriveDotTone({ connected: false, email: null, lastSyncAt: null }),
    'is-muted'
  );
  assert.equal(
    resolveDriveDotTone({ connected: true, email: 'a@b.c', lastSyncAt: 1, status: 'synced' }),
    'is-synced'
  );
  assert.equal(
    resolveDriveDotTone({ connected: true, email: 'a@b.c', lastSyncAt: 1, busy: true }),
    'is-syncing'
  );
  assert.equal(
    resolveDriveDotTone({
      connected: true,
      email: 'a@b.c',
      lastSyncAt: 1,
      status: 'syncing',
    }),
    'is-syncing'
  );
  assert.equal(
    resolveDriveDotTone({
      connected: true,
      email: 'a@b.c',
      lastSyncAt: 1,
      needsReauth: true,
      status: 'needs_reauth',
    }),
    'is-warn'
  );
  assert.equal(
    resolveDriveDotTone({
      connected: true,
      email: 'a@b.c',
      lastSyncAt: 1,
      status: 'error',
    }),
    'is-error'
  );
});

test('*2k design tokens match TubeDeck2k palette and avoid thick border-left slop', () => {
  const tokensCss = fs.readFileSync(path.join(rootDir, 'src/styles/tokens.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(rootDir, 'src/styles/app.css'), 'utf8');
  const popupCss = fs.readFileSync(path.join(rootDir, 'src/styles/popup.css'), 'utf8');

  for (const expectedToken of [
    '--bg: #f5f6f8',
    '--surface: #ffffff',
    '--surface-2: #eef0f4',
    '--border: #dde1e8',
    '--text: #1a1d24',
    '--text-muted: #5f6675',
    '--bg: #111318',
    '--surface: #1a1d24',
    '--surface-2: #232733',
    '--border: #2e3340',
    '--text: #e6e8ee',
    '--text-muted: #9aa1b2',
    '--accent: #3b82f6',
  ]) {
    assert.ok(tokensCss.includes(expectedToken), `Missing token ${expectedToken} in tokens.css`);
  }

  for (const [name, css] of [
    ['app.css', appCss],
    ['popup.css', popupCss],
  ]) {
    assert.equal(
      /border-left\s*:\s*[2-9]px/i.test(css),
      false,
      `${name} must not use thick border-left accents`
    );
  }
});

test('icon assets match manifest.json and include SVG source', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(rootDir, 'public/icons/BookmarkManager.svg')));

  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  for (const relPath of Object.values(manifest.icons) as string[]) {
    const abs = path.join(rootDir, relPath);
    assert.ok(fs.existsSync(abs), `Missing icon ${relPath}`);
    const head = fs.readFileSync(abs).subarray(0, 4);
    assert.deepEqual(head, pngSig, `Icon ${relPath} is not a valid PNG`);
  }
});

test('popup & *2k i18n keys resolve cleanly in English and Vietnamese', () => {
  const enT = createT('en');
  const viT = createT('vi');
  assert.equal(enT('appBrand'), 'Bookmark Manager');
  assert.equal(viT('appBrand'), 'Bookmark Manager');
  assert.ok(viT('popupReauthBanner').includes('Drive'));
  assert.ok(enT('popupSubtitle', { bookmarks: '7', collections: '4' }).includes('7'));
  assert.ok(viT('popupSubtitle', { bookmarks: '7', collections: '4' }).includes('4'));
});
