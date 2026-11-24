# Bookmark Manager

A polished Chrome extension bookmark manager inspired by Raindrop.io. Save, organize, and search bookmarks with collections, tags, smart filters, and quick-save.

## Features

### Core
- **Quick Save popup** — compact save flow for the current tab (title, collection, tags, notes)
- **Full dashboard** — open in a tab or Chrome Side Panel
- Automatic title / favicon detection and Open Graph cover previews
- Nested collections with drag-and-drop reorder
- Tags with autocomplete; personal notes on bookmarks
- Pin bookmarks and collections
- Bulk select: move, tag, pin/unpin, trash with undo
- Trash restore returns to the **original collection**
- Import browser bookmarks **keeping folder structure**, import/export JSON
- Context menu: “Save to Bookmark Manager”

### Search & smart views
- Search title, URL, tags, and notes (fuzzy)
- Operators: `tag:work`, `site:github.com`, `in:reading`, `note:todo`
- Smart collections: Pinned, Untagged, No cover, This week, Broken links
- Sort by newest, oldest, A–Z, domain, updated

### Productivity
- Keyboard shortcuts:
  - `Ctrl/⌘+Shift+Y` — save current tab
  - `Ctrl/⌘+Shift+B` — open dashboard
  - `/` — focus search
- Omnibox: type `bm` then a query in the address bar
- Broken-link checker (opt-in from Settings / maintenance)
- Auto-empty trash after N days (configurable)
- Multi-window UI sync via `chrome.storage.onChanged`
- **Google Drive sync** — bookmarks, collections & settings across devices (hidden App Data folder)
- Dark / light / system theme
- English + Tiếng Việt
- List virtualization for large libraries

## Tech Stack

- React 18 + TypeScript
- Vite + `@crxjs/vite-plugin`
- Tailwind CSS (class dark mode)
- Chrome Extensions Manifest V3

## Development

### Prerequisites

- Node.js 18+
- npm

### Install & run

```bash
npm install
npm run dev
```

### Production build

```bash
npm run build
```

## Loading the Extension

1. Run `npm run build`
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. **Load unpacked** → select the `dist` folder

## Google Drive sync setup

Sync stores one private JSON file (`bookmark-manager-sync-v2.json`) in Google Drive’s hidden **Application Data** folder. Only scope requested: `https://www.googleapis.com/auth/drive.appdata` (account email/name/photo come from `drive/v3/about`).

Sign-in uses `chrome.identity.launchWebAuthFlow` with an OAuth client of type **Web application** — the same code path on Chrome, Edge, Brave, Opera and Vivaldi. `getAuthToken` is not used.

### 1. Google Cloud (same project as the existing client)

1. **APIs & Services → Library** → enable **Google Drive API**
2. **OAuth consent screen** → scopes: `drive.appdata` only; publish (**In production**) or add test users while in Testing
3. **Credentials → OAuth client (Web application) → Authorized redirect URIs** → add one per extension ID:

   ```text
   https://<extension-id>.chromiumapp.org/
   ```

   The dev build has a fixed ID thanks to `"key"` in `manifest.json`; the Store build gets the Store’s ID. Settings → Sync → **Advanced** shows the exact ID and redirect URI with copy buttons.

> appDataFolder belongs to the Cloud **project**, not to the client: a new client must be created in the same project or existing sync data will not be visible.

### 2. Build

```bash
# optional — src/driveSync.ts has the project client ID built in
VITE_GOOGLE_CLIENT_ID=YOUR_ID.apps.googleusercontent.com
npm run build          # dist/ (unpacked, with "key" → stable dev ID)
npm run build:store    # dist-store/ (same build, "key" removed for the Chrome Web Store)
npm test               # merge / migration / engine tests (node --test)
```

### 3. Behaviour

Open the **full Dashboard** (the popup closes when the Google window opens) → **Settings → Sync → Connect**.

- Per-record last-write-wins on `updatedAt`; ties broken by `deviceId` so every device picks the same winner
- Deletions are tombstones kept for 180 days; a device offline longer than that cannot resurrect deleted bookmarks
- Uploads only when Drive is missing something; checks `files.version` right before writing and re-merges (up to 3×) if another device wrote in between
- Merged data is applied to this device record by record against the freshest local state, so bookmarks saved during a sync are kept
- Duplicate URLs are collapsed (tags/notes/covers merged)
- Roaming settings (theme, language, default view/sort/collection, previews, trash days, quick save, side panel) sync LWW; auto-sync on/off stays per device
- Schedule: browser start, every 15 minutes, ~5 s after a change, and **Sync now**; network/429/5xx errors are retried with backoff; skipped while offline
- A pre-merge backup of local data is kept (Settings → Sync → Advanced → Download backup); it can be re-imported via Import JSON
- Corrupt or newer-schema files on Drive are never overwritten; local data stays as is
- Upgrading from ≤ 1.2.0: the first sync reads the old `bookmark-manager-sync.json` (v1), merges it and writes the v2 file. The v1 file is left untouched
- **Disconnect** revokes the token only; **Delete Drive data** (Advanced) removes the sync files and disconnects

The sync core lives in `src/shared/driveSync/` and has no dependency on this app (shared verbatim with TubeDeck2k); the app-specific adapter is `src/sync/bookmarkSyncDoc.ts` + `src/driveSync.ts`.

## Project Structure

```
src/
├── background.ts         # Service worker (CRUD, import, omnibox, commands, Drive sync)
├── driveSync.ts          # Drive sync wiring (auth config, adapter, status for UI)
├── sync/bookmarkSyncDoc.ts  # Bookmarks ↔ sync document (v2), v1 migration, URL dedupe
├── shared/driveSync/     # App-agnostic Drive sync core (auth, client, merge, engine, strings)
├── App.tsx               # Main UI (popup library + dashboard)
├── components/
│   ├── QuickSave.tsx     # Compact popup save
│   ├── SettingsModal.tsx # Theme, locale, Drive sync, shortcuts
│   └── …                 # Cards, list, sidebar, modals
├── i18n.ts               # en / vi strings
├── storage.ts            # chrome.storage.local I/O
├── types.ts              # Domain + message types
└── utils.ts              # Search, theme, collections helpers
```

## License

MIT
