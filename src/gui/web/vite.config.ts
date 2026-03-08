import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: rootDir,
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          content: ["./index.html", "./src/**/*.{ts,tsx}"],
          darkMode: "class",
          theme: {
            extend: {
              fontFamily: {
                sans: ["Outfit", "system-ui", "sans-serif"],
                mono: ["JetBrains Mono", "ui-monospace", "monospace"],
              },
            },
          },
          plugins: [],
        }),
        autoprefixer(),
      ],
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:50777", changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(rootDir, "../../../dist/gui"),
    emptyOutDir: true,
  },
});
