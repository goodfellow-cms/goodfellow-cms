#!/usr/bin/env node
// After `next build`: `goodfellow-next finish out` fixes the export's prefetch files on Windows,
// writes the calendar files of collections of events and the pages at redirects' old addresses, and the search index for sites with a search block. `index` only writes the index.
// `goodfellow-next update` updates Goodfellow, as `goodfellow update` does for other sites.
// `goodfellow-next content link|copy [folder]` puts a content repository's files in place, for a site whose
// content is kept in a repository of its own.
import { rm } from "node:fs/promises";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { formatUpdateResult } from "@goodfellow-cms/core";
import { ContentRepositoryError, setUpContentRepository, update } from "@goodfellow-cms/core/node";
import { writePagesSearchIndex, writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { builtPages, fixSegmentFiles, writeCalendarFiles, writeRedirectFiles } from "@goodfellow-cms/next/export";

const [command, dir = "out"] = process.argv.slice(2);
// A full-stack site (withGoodfellow(config, { server: true })): Next.js serves its pages and sends redirects
// itself, so the calendar files and the search index are written into public/, which `next start` and hosts
// serve as static files, as they are for an export.
if (command === "finish" && dir === "--server") {
  await rm("public/calendars", { recursive: true, force: true });
  const calendars = await writeCalendarFiles("public");
  if (calendars > 0) console.log(`Wrote ${calendars} calendar files, in public/calendars`);
  const indexed = await writePagesSearchIndex(await builtPages(), "public/pagefind");
  console.log(
    indexed === undefined
      ? "No page has a search block, so there's nothing to index"
      : `Indexed ${indexed} pages for search, in public/pagefind`,
  );
  process.exit(0);
}
if (command === "update") {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { to: { type: "string" }, publish: { type: "boolean" } },
  });
  const result = await update({ to: values.to, publish: values.publish });
  // For the admin panel, which reads it in the host's log.
  console.log(formatUpdateResult(result));
  process.exit(result.state === "failed" ? 1 : 0);
}
if (command === "content") {
  const [action, from] = process.argv.slice(3);
  if (action === "link" || action === "copy") {
    try {
      const folder =
        relative(process.cwd(), await setUpContentRepository(".", { from, copy: action === "copy" })) || ".";
      console.log(
        action === "copy"
          ? `Copied content/ and public/media/ from ${folder}`
          : `Linked content/ and public/media/ to ${folder}, so the site's content is the content repository's`,
      );
      process.exit(0);
    } catch (error) {
      if (!(error instanceof ContentRepositoryError)) throw error;
      console.error(error.message);
      process.exit(1);
    }
  }
}
if (command !== "finish" && command !== "index") {
  console.error(
    [
      "Usage: goodfellow-next finish [folder]",
      "       goodfellow-next finish --server",
      "       goodfellow-next index [folder]",
      "       goodfellow-next update [--to fixes|automatic|latest|<release>] [--publish]",
      "       goodfellow-next content link|copy [folder]",
      "",
      "finish  Gets the exported site in folder (default: out) ready to publish: puts the files",
      "        Next.js uses to load pages ahead where browsers look for them, writes calendar files",
      "        for collections of events and pages that send visitors on from old addresses, and",
      "        indexes it for search. With --server, for a full-stack site, writes the calendar",
      "        files into public/calendars and indexes the pages next build rendered into",
      "        public/pagefind instead.",
      "index   Only indexes the exported site for its search block.",
      "update  Updates Goodfellow, and blocks from its registry, if the site still builds.",
      "content For a site whose content is kept in a repository of its own: links content/ and",
      "        public/media/ to the content repository in folder (default: content-repository),",
      "        or copies them from it, as builds do.",
    ].join("\n"),
  );
  process.exit(1);
}
if (command === "finish") {
  const moved = await fixSegmentFiles(dir);
  if (moved > 0) console.log(`Moved ${moved} of Next.js's prefetch files to where browsers look for them`);
  const calendars = await writeCalendarFiles(dir);
  if (calendars > 0) console.log(`Wrote ${calendars} calendar files`);
  const redirects = await writeRedirectFiles(dir);
  if (redirects > 0) console.log(`Wrote ${redirects} redirects`);
}
const indexed = await writeSearchIndex(dir);
console.log(
  indexed === undefined
    ? `No page in ${dir} has a search block, so there's nothing to index`
    : `Indexed ${indexed} pages for search`,
);
