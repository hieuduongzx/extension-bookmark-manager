/**
 * Chrome Web Store build: same output as `npm run build`, copied to dist-store/ with the
 * manifest "key" removed (the Store assigns its own ID and rejects a public key field).
 *   npm run build:store
 * Does not change the version and does not zip/publish anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const storeDir = path.join(rootDir, 'dist-store');

execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

fs.rmSync(storeDir, { recursive: true, force: true });
fs.cpSync(distDir, storeDir, { recursive: true });
fs.rmSync(path.join(storeDir, 'stats.html'), { force: true });

const manifestPath = path.join(storeDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
delete manifest.key;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const verify = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if ('key' in verify) throw new Error('dist-store/manifest.json must not contain "key"');
if ('oauth2' in verify) throw new Error('dist-store/manifest.json must not contain "oauth2"');

console.log(`[Bookmark Manager] Store build -> dist-store/ (version ${verify.version}, no "key")`);
