# Bookmark Manager

A beautiful bookmark manager Chrome extension inspired by Raindrop.io. Save, organize, and search your bookmarks with collections and tags.

## Features

- Save bookmarks with automatic title and favicon detection
- Organize bookmarks into nested collections (drag-and-drop reorder)
- Tag bookmarks for easy categorization with autocomplete
- Powerful search across titles, URLs, and tags
- Add personal notes to bookmarks
- Pin favorite bookmarks and collections
- Bulk select / move to trash with undo
- Import from browser bookmarks or JSON, export to JSON
- Auto-fetch link previews (Open Graph / Twitter cards)
- AI-powered tag and collection suggestions (optional)

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** + **@crxjs/vite-plugin** - Build tool
- **Tailwind CSS** - Styling
- **Chrome Extensions Manifest V3** - Extension API
- **Lucide React** - Icons

## Development

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Install dependencies

```bash
npm install
```

### Development mode

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

## Loading the Extension

1. Run `npm run build` to build the extension
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the `dist` folder

## Project Structure

```
src/
├── background.ts      # Service worker for background tasks
├── main.tsx           # React entry point
├── App.tsx            # Main application component
├── components/        # React components
├── storage.ts         # Chrome storage utilities
├── types.ts           # TypeScript type definitions
├── utils.ts           # Utility functions
├── ai.ts              # AI tag suggestion logic
└── index.css          # Global styles
```

## License

MIT
