import { isAbsolute, relative, resolve } from "node:path";
import { type BuildCause, ContentError, formatBuildCause } from "@goodfellow-cms/core";

const MAX_MESSAGE = 1000;

/** Terminal colors in tools' messages, which mean nothing in the admin panel. */
const ANSI_CODES = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*[A-Za-z]`, "g");

/** A file inside the site's folder, relative to it, or `undefined` for files elsewhere, such as packages'. */
function siteFile(root: string, path: unknown): string | undefined {
  if (typeof path !== "string" || !path) return undefined;
  const file = relative(root, isAbsolute(path) ? path : resolve(root, path)).replaceAll("\\", "/");
  return file.startsWith("..") || file.includes("node_modules/") ? undefined : file;
}

/** The first file of the site's own in an error's stack, such as the block that threw. */
function stackFile(root: string, stack: string | undefined): string | undefined {
  for (const match of (stack ?? "").matchAll(/(?:\(|at )((?:file:\/\/)?\/[^():]+|[A-Za-z]:\\[^():]+):\d+:\d+/g)) {
    const file = siteFile(root, (match[1] ?? "").replace(/^file:\/\//, ""));
    if (file) return file;
  }
  return undefined;
}

/** What went wrong in a failed build: a content file, or code, with the file where it can tell. */
export function buildCause(error: unknown, root: string): BuildCause {
  if (error instanceof ContentError) {
    return {
      kind: "content",
      file: error.problems[0]?.file,
      message: error.problems.map((problem) => `${problem.file}: ${problem.message}`).join("\n"),
    };
  }
  const details = (error ?? {}) as { id?: unknown; loc?: { file?: unknown }; message?: unknown; stack?: string };
  const message = String(details.message ?? error)
    .replace(ANSI_CODES, "")
    .slice(0, MAX_MESSAGE);
  const file =
    siteFile(root, details.id) ?? siteFile(root, details.loc?.file) ?? stackFile(root, details.stack ?? undefined);
  return { kind: "code", message, ...(file && { file }) };
}

/** GitHub Actions' workflow command escaping, for a message or a property. */
function escapeCommand(text: string, property = false): string {
  const escaped = text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return property ? escaped.replaceAll(":", "%3A").replaceAll(",", "%2C") : escaped;
}

/**
 * Prints why the build failed on a line of its own, which the admin panel finds in
 * the host's log, and on GitHub Actions as an annotation on the file too.
 */
export function reportBuildCause(cause: BuildCause, env: NodeJS.ProcessEnv = process.env): string[] {
  const lines = [formatBuildCause(cause)];
  if (env.GITHUB_ACTIONS === "true") {
    const title = cause.kind === "content" ? "A content file has a problem" : "The site's code couldn't be built";
    const file = cause.file ? `file=${escapeCommand(cause.file, true)},` : "";
    lines.push(`::error ${file}title=${escapeCommand(title, true)}::${escapeCommand(cause.message)}`);
  }
  return lines;
}
