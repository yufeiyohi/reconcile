import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    {
      name: "local-security-and-notices",
      transformIndexHtml(html) {
        // Vite's development-only React refresh preamble is inline.
        return command === "serve"
          ? html.replace(
              "script-src 'self';",
              "script-src 'self' 'unsafe-inline';",
            )
          : html;
      },
      generateBundle() {
        for (const fileName of ["LICENSE", "THIRD-PARTY-NOTICES.txt"]) {
          this.emitFile({
            type: "asset",
            fileName,
            source: readFileSync(new URL(fileName, import.meta.url), "utf8"),
          });
        }
      },
    },
  ],
  optimizeDeps: {
    include: [
      "papaparse",
      "read-excel-file/universal",
      "fflate",
      "@e965/xlsx",
      "@thednp/dommatrix",
      "pdfjs-dist/legacy/build/pdf.mjs",
    ],
  },
  worker: { format: "es" },
  base: process.env.VITE_BASE_PATH || "./",
  test: { include: ["tests/unit/**/*.test.ts"] },
}));
