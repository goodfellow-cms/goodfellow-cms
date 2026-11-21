import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { relative, sep } from "node:path";
import { isServedFrameFile } from "@goodfellow-cms/core/node";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  map: "application/json",
  png: "image/png",
  woff: "font/woff",
  woff2: "font/woff2",
};

/**
 * Sends `file`, in the frame's folder `folder` (the editor's, or a plugin's), as `res`'s answer, and says whether it
 * did: `false` where it isn't there, for the next middleware. A file the folder may not hold (`isServedFrameFile()`),
 * such as a page a module brought, which the build stopped at but leaves where it is until the module no longer
 * brings it, gets a 404, so it never opens at this address.
 */
export async function sendFrameFile(
  req: IncomingMessage,
  res: ServerResponse,
  folder: string,
  file: string,
): Promise<boolean> {
  if (!(await isServedFrameFile(file, relative(folder, file).split(sep).join("/")))) {
    res.writeHead(404).end();
    return true;
  }
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch {
    return false;
  }
  res.setHeader("Content-Type", TYPES[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.end(req.method === "HEAD" ? undefined : data);
  return true;
}
