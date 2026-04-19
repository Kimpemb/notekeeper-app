// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // Tauri target — WebKit on Windows/Linux, WKWebView on macOS
    target: ["es2021", "chrome100", "safari13"],
    // Don't inline small assets — let them be separate cacheable files
    assetsInlineLimit: 0,
    // Source maps off in production
    sourcemap: false,
    // Raise warning threshold slightly — we're actively splitting
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core
          if (id.includes("node_modules/react/") ||
              id.includes("node_modules/react-dom/") ||
              id.includes("node_modules/react-is/") ||
              id.includes("node_modules/scheduler/")) {
            return "react-core";
          }

          // TipTap + ProseMirror
          if (id.includes("node_modules/@tiptap/") ||
              id.includes("node_modules/prosemirror-") ||
              id.includes("node_modules/@prosemirror/")) {
            return "editor-core";
          }

         // D3 only — not src/features/graph which is statically imported
  if (id.includes("node_modules/d3/") ||
      id.includes("node_modules/d3-")) {
    return "graph";
  }

  // Remaining node_modules → vendor
  if (id.includes("node_modules/")) {
    return "vendor";
  }

  // These src chunks genuinely reduce index size despite the
  // static/dynamic warnings — keep them.
  if (id.includes("src/features/ai/")) {
    return "ai";
  }
  if (id.includes("src/features/notes/similarity/")) {
    return "similarity";
  }
  if (id.includes("src/features/canvas/")) {
    return "canvas";
  }
        },
      },
    },
  },

  // Optimise deps pre-bundling in dev — speeds up cold start
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "zustand",
      "@tauri-apps/api",
      "@tauri-apps/plugin-sql",
    ],
    exclude: [
      // Don't pre-bundle heavy optional features
      "src/features/ai",
      "src/features/backup",
      "src/features/notes/similarity",
    ],
  },
});