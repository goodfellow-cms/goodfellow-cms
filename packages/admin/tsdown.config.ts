import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "tsdown";

/** The release of Goodfellow's block registry this admin panel installs blocks from. */
const registryVersion: string = createRequire(import.meta.url)("@goodfellow-cms/registry/package.json").version;

/**
 * The SHA-256 of each file of the token broker's page, from the broker built with this release, which Add a token
 * broker checks the files it downloads against. The build fails without them, rather than ship an admin panel that
 * copies whatever the address answers.
 */
const brokerFiles = join(
  dirname(createRequire(import.meta.url).resolve("@goodfellow-cms/broker/package.json")),
  "site",
  "files.json",
);
const brokerDigests: Record<string, string> = JSON.parse(readFileSync(brokerFiles, "utf8")).digests;
if (!brokerDigests || Object.keys(brokerDigests).length === 0) {
  throw new Error(`${brokerFiles} has no digests: build @goodfellow-cms/broker first.`);
}

export default defineConfig({
  entry: ["src/index.ts", "src/dev.ts", "src/editor.ts", "src/plugin.ts", "src/text.ts"],
  format: "esm",
  dts: true,
  platform: "browser",
  fixedExtension: false,
  define: {
    __GOODFELLOW_REGISTRY_VERSION__: JSON.stringify(registryVersion),
    __GOODFELLOW_BROKER_DIGESTS__: JSON.stringify(brokerDigests),
  },
});
