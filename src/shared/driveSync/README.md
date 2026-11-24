# shared/driveSync

App-agnostic Google Drive (`appDataFolder`) sync core shared by Bookmark Manager and TubeDeck2k.
Keep this folder identical in both repos — copy it as a whole; do not import app code from here.

| File | Role |
|------|------|
| `types.ts` | `SyncDocument` / `SyncRecord` / state / error types, tombstone retention (180 days) |
| `auth.ts` | `launchWebAuthFlow` (Web application client), token cache with `expiresAt`, `needs_reauth`, revoke |
| `driveClient.ts` | Drive v3 REST: list / download / version / create / update / delete / about, retry + backoff, 401 refresh |
| `merge.ts` | Per-record LWW (`updatedAt`, then `deviceId`, then content), tombstones + pruning, strict remote validation |
| `engine.ts` | `runSyncCycle` (compare-then-write on `files.version`, per-record local apply) + engine (singleflight, debounce, alarms, retry) |
| `strings.ts` | vi / en error texts (`formatDriveError`) and relative time |

An app provides a `SyncAdapter` (see `engine.ts`): file names, `buildLocalDoc`, `parseRemote`,
optional `convertLegacy` / `normalize`, `updateLocal` (atomic per-record apply) and `saveBackup`.

Internal imports use explicit `.ts` extensions so `node --test` can load the files directly.
