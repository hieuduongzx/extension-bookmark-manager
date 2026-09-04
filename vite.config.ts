import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { visualizer } from "rollup-plugin-visualizer";
import manifest from "./manifest.json";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const clientId =
    env.VITE_GOOGLE_CLIENT_ID?.trim() ||
    (manifest as { oauth2?: { client_id?: string } }).oauth2?.client_id ||
    "YOUR_CLIENT_ID.apps.googleusercontent.com";

  const manifestWithOauth = {
    ...manifest,
    oauth2: {
      client_id: clientId,
      scopes: [
        "https://www.googleapis.com/auth/drive.appdata",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    },
  };

  return {
    plugins: [
      react(),
      crx({ manifest: manifestWithOauth as typeof manifest }),
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
  };
});
