import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { normalizeBase } from "@goodfellow-cms/core";

export interface PreviewOptions {
  root?: string;
  outDir?: string;
  base?: string;
  port?: number;
  /** Let other computers on the network see the preview, which by default only this one can. */
  network?: boolean;
}

/** Whether a request comes from this computer. */
function fromThisComputer(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
}

/**
 * Serves a built site the way static hosts do: `/about` serves `about/index.html`,
 * and anything missing gets `404.html`.
 */
export async function preview(options: PreviewOptions = {}): Promise<Server> {
  const root = resolve(options.root ?? ".");
  const outDir = resolve(root, options.outDir ?? "dist");
  const base = normalizeBase(options.base);
  const port = options.port ?? 4322;

  const server = createServer(async (req, res) => {
    // A preview may show what isn't published yet, so others on the network see it only when asked.
    if (!options.network && !fromThisComputer(req.socket.remoteAddress)) {
      res.writeHead(403, { "Content-Type": "text/plain" }).end("This preview is only for this computer.");
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (!`${pathname}/`.startsWith(base)) {
      res.writeHead(302, { Location: base }).end();
      return;
    }

    const relativePath = normalize(pathname.slice(base.length - 1));
    const target = join(outDir, relativePath);
    if (target !== outDir && !target.startsWith(outDir + sep)) {
      res.writeHead(403).end();
      return;
    }

    for (const candidate of [target, join(target, "index.html"), `${target}.html`]) {
      if (await isFile(candidate)) {
        res.writeHead(200, { "Content-Type": TYPES[extname(candidate)] ?? "application/octet-stream" });
        createReadStream(candidate).pipe(res);
        return;
      }
    }

    const notFound = join(outDir, "404.html");
    if (await isFile(notFound)) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      createReadStream(notFound).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    }
  });

  await new Promise<void>((done) => server.listen(port, done));
  console.log(`  Preview: http://localhost:${port}${base}`);
  return server;
}
