// Builds a copy of the company example into a Cloudflare Worker with vinext, as its deploy workflow does, gives it
// a local D1 database with an admin and an editor, and serves the built Worker in workerd, as Cloudflare would,
// with a fake GitHub as its content repository and a fake Resend for its email. POST /__reset to the fake GitHub
// starts it afresh; GET /__sent from the fake Resend lists what it was sent.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { COMPANY, COMPANY_PASSWORD, COMPANY_PEOPLE, companyFiles, companySite, createCompanySite } from "./site.mjs";

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
    repo: COMPANY.repo,
    files: companyFiles(),
    tokens: { [COMPANY.token]: { login: "company-bot", name: "Company bot" } },
  });
let github = newGitHub();
// How many requests the Worker has made to GitHub, so tests can tell a page it rendered from one Workers Cache kept.
let requests = 0;
serve(COMPANY.github, async (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/__reset") {
    github = newGitHub();
    requests = 0;
    return new Response(null, { status: 204 });
  }
  if (pathname === "/__requests") return Response.json({ requests });
  requests++;
  return github.handle(request);
});

// Resend's API, as the site sends email: it keeps each message, sent with the site's key, for the tests to read.
const sent = [];
serve(COMPANY.resend, async (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/__sent") return Response.json(sent);
  if (request.method !== "POST" || pathname !== "/emails") return new Response(null, { status: 404 });
  if (request.headers.get("authorization") !== "Bearer re_company_test") return new Response(null, { status: 401 });
  const message = await request.json();
  // One recipient comes as a string, several as a list.
  sent.push({ ...message, to: [message.to].flat() });
  return Response.json({ id: String(sent.length) });
});

/** A package's command, run with this Node, from the copy's packages. */
function bin(pkg, name = pkg) {
  const manifest = JSON.parse(readFileSync(join(companySite, "node_modules", pkg, "package.json"), "utf8"));
  const file = typeof manifest.bin === "string" ? manifest.bin : manifest.bin[name];
  return join(companySite, "node_modules", pkg, file);
}

function run(pkg, args, name) {
  const done = spawnSync(process.execPath, [bin(pkg, name), ...args], {
    cwd: companySite,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (done.status !== 0) process.exit(done.status ?? 1);
}

createCompanySite();

// vinext's report never fails, so a gap it finds in the example would otherwise go unnoticed until something broke.
const { runCheck } = await import(pathToFileURL(join(companySite, "node_modules/vinext/dist/check.js")).href);
const { summary } = runCheck(companySite);
if (summary.unsupported > 0 || summary.partial > 0) {
  console.error(`vinext check found ${summary.unsupported} unsupported and ${summary.partial} partly supported uses.`);
  console.error("Run `npx vinext check` in examples/company for what they are.");
  process.exit(1);
}

// The build script: what `goodfellow-next finish --server` writes, then the Worker.
run("@goodfellow-cms/next", ["finish", "--server"], "goodfellow-next");
run("vinext", ["build"]);

// A database of its own each time, with the accounts the tests sign in as. (`.wrangler/deploy/` says where the
// build put the Worker, so only the state goes.)
rmSync(join(companySite, ".wrangler/state"), { recursive: true, force: true });
run("wrangler", ["d1", "migrations", "apply", "goodfellow-company", "--local"]);
const hashed = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    'import { hashPassword } from "better-auth/crypto"; console.log(await hashPassword(process.argv[1]));',
    COMPANY_PASSWORD,
  ],
  { cwd: companySite, encoding: "utf8" },
);
if (hashed.status !== 0) throw new Error(hashed.stderr);
const hash = hashed.stdout.trim();
const now = new Date().toISOString();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = Object.entries(COMPANY_PEOPLE).flatMap(([id, person]) => [
  `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt, role) values (${[id, person.name, person.email, 1, now, now, person.role].map(quote).join(", ")});`,
  `insert into account (id, accountId, providerId, userId, password, createdAt, updatedAt) values (${[`${id}-password`, id, "credential", id, hash, now, now].map(quote).join(", ")});`,
]);
run("wrangler", ["d1", "execute", "goodfellow-company", "--local", "--command", rows.join(" ")]);

// The built Worker in workerd, with the local database and what .dev.vars says.
const server = spawn(
  process.execPath,
  [bin("vite"), "preview", "--port", String(process.argv[2] ?? COMPANY.port), "--strictPort"],
  { cwd: companySite, stdio: "inherit" },
);
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
