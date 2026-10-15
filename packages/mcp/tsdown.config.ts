import { defineConfig } from "tsdown";

export default defineConfig([
  {
    // The tools, which run anywhere: on the editor's computer, and in the hosted connector's Worker.
    entry: ["src/index.ts"],
    format: "esm",
    dts: true,
    platform: "neutral",
    // Puck's types are only used inside, so its type declarations aren't copied in.
    deps: { neverBundle: [/^@puckeditor\/core/] },
  },
  {
    // The server on the editor's computer, which Claude Desktop and Claude Code start, and its screenshots.
    entry: ["src/stdio.ts", "src/screenshots.ts"],
    format: "esm",
    dts: true,
    platform: "node",
    clean: false,
    fixedExtension: false,
    deps: { neverBundle: [/^@puckeditor\/core/] },
  },
]);
