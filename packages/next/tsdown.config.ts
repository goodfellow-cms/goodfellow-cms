import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.tsx", "src/config.ts", "src/admin.tsx", "src/components.tsx", "src/export.ts", "src/server.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
  fixedExtension: false,
  // Next.js resolves these itself, with the right build for server or browser.
  deps: { neverBundle: [/^node:/, /^next(\/|$)/, /^@goodfellow-cms\//, /^@puckeditor\//, /^react(-dom)?(\/|$)/] },
  // Keeps the admin panel's stylesheet imports, for Next.js to bundle.
  treeshake: { moduleSideEffects: (id) => id.endsWith(".css") },
  inputOptions: {
    // "use client" modules are their own entries, so their directive is kept; Next.js's tests depend on it.
    onLog(level, log, handler) {
      if (log.code !== "MODULE_LEVEL_DIRECTIVE") handler(level, log);
    },
  },
});
