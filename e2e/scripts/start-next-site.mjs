// Runs `next dev` on a copy of the Next.js template.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createNextSite, nextSite } from "./site.mjs";

createNextSite();
const next = createRequire(join(nextSite, "package.json")).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "dev", "--port", process.argv[2] ?? "4403", "-H", "127.0.0.1"], {
  cwd: nextSite,
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
