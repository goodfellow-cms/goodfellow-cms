import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "goodfellow";
import { BROKER_ADDRESSES } from "./site.mjs";

// The built token broker, as a site's owner deploys it: its files, and a broker.json naming the site's repository.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../.broker");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
cpSync(join(here, "../../packages/broker/site"), root, { recursive: true });
writeFileSync(
  join(root, "broker.json"),
  `${JSON.stringify({ sites: [{ package: "@goodfellow-cms/github", export: "github", options: { repo: "parish/site" } }] }, null, 2)}\n`,
);
await preview({ root, outDir: ".", port: Number(new URL(BROKER_ADDRESSES.broker).port) });
