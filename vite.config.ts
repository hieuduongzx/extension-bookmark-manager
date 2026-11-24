import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { visualizer } from "rollup-plugin-visualizer";
import manifest from "./manifest.json";

// Google OAuth client ID comes from VITE_GOOGLE_CLIENT_ID (see .env.example) via
// import.meta.env in src/driveSync.ts — the manifest no longer carries an oauth2 block
// (sign-in uses chrome.identity.launchWebAuthFlow with a Web application client).
//
// manifest.json keeps a public "key" so the unpacked dev build has a stable extension ID
// (and therefore a stable OAuth redirect URI). `npm run build:store` strips it.

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    visualizer({
      open: false,
      gzipSize: true,
      brotliSize: true,
      filename: "dist/stats.html",
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
