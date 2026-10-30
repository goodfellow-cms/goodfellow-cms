/**
 * Publishing the site's admin text (`content/admin-text/`) beside the admin
 * panel, as `goodfellow build` and `goodfellow-next finish` do, so the sign-in
 * screen speaks the site's languages before it can read the site's files.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PUBLISHED_ADMIN_TEXT_DIR, publishedAdminText, readAdminText } from "./content/admin-text.js";
import type { ContentProblem } from "./content/errors.js";
import { fileSystemSource } from "./node-fs-source.js";

export interface WrittenAdminText {
  /** The languages written, by code. */
  languages: string[];
  /** Files that couldn't be read, which were left out. */
  problems: ContentProblem[];
}

/**
 * Writes `admin/text/` into a built site from the site's files at `root`,
 * replacing what was there, so a language removed from the site goes too.
 */
export async function writeAdminText(outDir: string, root = process.cwd()): Promise<WrittenAdminText> {
  const { files, problems } = await readAdminText(fileSystemSource(resolve(root)));
  await rm(join(outDir, PUBLISHED_ADMIN_TEXT_DIR), { recursive: true, force: true });
  for (const file of publishedAdminText(files)) {
    const target = join(outDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  return { languages: Object.keys(files).sort(), problems };
}

/** What writing the admin text says, a line each: the languages, and files left out. */
export function formatAdminText(written: WrittenAdminText): string[] {
  return [
    ...(written.languages.length > 0
      ? [`Wrote the admin panel's text in ${written.languages.join(", ")}, in ${PUBLISHED_ADMIN_TEXT_DIR}/`]
      : []),
    ...written.problems.map(
      (problem) => `Left out ${problem.file}, which the admin panel can't use: ${problem.message}`,
    ),
  ];
}
