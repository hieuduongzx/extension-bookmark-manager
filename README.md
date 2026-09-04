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
- **Google Drive sync** — bidirectional backup of bookmarks & collections (App Data folder)
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

Sync stores a private JSON file in Google Drive’s **Application Data** folder (hidden from the normal Drive UI).

| Browser | Auth API |
|---------|----------|
| **Google Chrome** | `chrome.identity.getAuthToken` (or web flow fallback) |
| **Microsoft Edge** | `chrome.identity.launchWebAuthFlow` only — **getAuthToken is not supported** |

### 1. Enable APIs & consent

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or pick an existing one)
3. **APIs & Services → Library** → enable **Google Drive API**
4. **OAuth consent screen** → External is fine; add your Google account as a **Test user** while in Testing

### 2. Create OAuth client (pick one)

#### A) Microsoft Edge (recommended: works on Edge + Chrome)

1. **Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. **Authorized redirect URIs** → add exactly (see Settings → Google Drive after load):

   ```text
   https://YOUR_EXTENSION_ID.chromiumapp.org/
   ```

   Extension ID is on `edge://extensions` / `chrome://extensions` (Developer mode). Trailing `/` matters — copy from the app’s **Redirect URI** line if unsure.

4. Copy the client ID (`….apps.googleusercontent.com`)

#### B) Chrome only (optional)

1. Application type: **Chrome Extension**
2. Item ID = your extension ID  
3. Works with `getAuthToken` on Chrome; **will fail on Edge**

### 3. Configure the extension

```bash
# .env (not committed)
VITE_GOOGLE_CLIENT_ID=YOUR_ID.apps.googleusercontent.com
npm run build
```

Reload the unpacked extension after build. If the extension ID changes (re-load unpacked), update the redirect URI / Item ID in Google Cloud.

### 4. Connect in the app

Open the **full Dashboard** (not the tiny popup) → **Settings → Google Drive → Connect** → sign in → **Sync now**.

- Merge is last-write-wins per bookmark/collection (`updatedAt`)
- Optional auto-sync every 30 minutes while the browser is running
- On Edge, access tokens expire (~1h); the next **Sync now** / auto-sync re-auths (may need a click if the session expired)
- **Disconnect** only revokes the local token; the Drive app-data file remains

## Project Structure

```
src/
├── background.ts         # Service worker (CRUD, import, omnibox, commands, Drive sync)
├── gdrive.ts             # Google Drive App Data API + merge
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
