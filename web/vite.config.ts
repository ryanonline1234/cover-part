import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API (engine/coverpart/api.py, FastAPI) is optional. In dev, /api is proxied to it
// so live mode can be tried locally; the demo deploy only serves public/demos/*.json.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    // verovio's WASM toolkit is one ~7 MB lazily loaded chunk; that is expected.
    chunkSizeWarningLimit: 8000,
  },
});
