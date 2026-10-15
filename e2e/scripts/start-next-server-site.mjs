// Builds a copy of the Next.js template as a full-stack site and runs it with `next start`, with fakes of
// GitHub and an AI service that only its server calls. POST /__reset to the fake GitHub starts it afresh.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fakeAi } from "@goodfellow-cms/ai/testing";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { createNextServerSite, NEXT_SERVER, nextServerSite, starterFiles } from "./site.mjs";

/** Serves a fake's `handle` over HTTP, as the real service would be. */
function serve(port, handle) {
  createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const response = await handle(
      new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([name, value]) =>
          typeof value === "string" ? [[name, value]] : [],
        ),
        body: body.length > 0 && req.method !== "GET" ? body : undefined,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(port, "127.0.0.1");
}

const newGitHub = () =>
  fakeGitHub({
    repo: "parish/site",
    files: starterFiles(),
    tokens: { [NEXT_SERVER.token]: { login: "parish-bot", name: "Parish bot" } },
  });
let github = newGitHub();
serve(NEXT_SERVER.github, async (request) => {
  if (new URL(request.url).pathname === "/__reset") {
    github = newGitHub();
    return new Response(null, { status: 204 });
  }
  return github.handle(request);
});
const ai = fakeAi({
  keys: [NEXT_SERVER.aiKey],
  answer: () => ({
    blocks: [
      { type: "Heading", id: "h", parent: null, slot: null, props: { text: "Written by the site's AI", level: "h2" } },
    ],
  }),
});
serve(NEXT_SERVER.ai, ai.handle);

createNextServerSite();
const next = createRequire(join(nextServerSite, "package.json")).resolve("next/dist/bin/next");
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  GOODFELLOW_GIT_TOKEN: NEXT_SERVER.token,
  TEST_GITHUB_API: `http://127.0.0.1:${NEXT_SERVER.github}`,
  TEST_AI_URL: `http://127.0.0.1:${NEXT_SERVER.ai}`,
  TEST_AI_KEY: NEXT_SERVER.aiKey,
};
const built = spawnSync(process.execPath, [next, "build"], { cwd: nextServerSite, stdio: "inherit", env });
if (built.status !== 0) process.exit(built.status ?? 1);
const server = spawn(process.execPath, [next, "start", "--port", String(process.argv[2] ?? NEXT_SERVER.port)], {
  cwd: nextServerSite,
  stdio: "inherit",
  env,
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
