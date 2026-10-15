#!/usr/bin/env node
// After `next build`: `goodfellow-next finish out` fixes the export's prefetch files on Windows,
// writes the calendar files of collections of events and the pages at redirects' old addresses, and the search index for sites with a search block. `index` only writes the index.
// `goodfellow-next update` updates Goodfellow, as `goodfellow update` does for other sites.
import { parseArgs } from "node:util";
import { formatUpdateResult } from "@goodfellow-cms/core";
import { update } from "@goodfellow-cms/core/node";
import { writePagesSearchIndex, writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { builtPages, fixSegmentFiles, writeCalendarFiles, writeRedirectFiles } from "@goodfellow-cms/next/export";

const [command, dir = "out"] = process.argv.slice(2);
// A full-stack site (withGoodfellow(config, { server: true })): Next.js serves its pages, calendar files and
// redirects itself, so only the search index is written, into public/, which `next start` and hosts serve.
if (command === "finish" && dir === "--server") {
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
if (command !== "finish" && command !== "index") {
  console.error(
    [
      "Usage: goodfellow-next finish [folder]",
      "       goodfellow-next finish --server",
      "       goodfellow-next index [folder]",
      "       goodfellow-next update [--to fixes|automatic|latest|<release>] [--publish]",
      "",
      "finish  Gets the exported site in folder (default: out) ready to publish: puts the files",
      "        Next.js uses to load pages ahead where browsers look for them, writes calendar files",
      "        for collections of events and pages that send visitors on from old addresses, and",
      "        indexes it for search. With --server, for a full-stack site, indexes the pages",
      "        next build rendered into public/pagefind instead.",
      "index   Only indexes the exported site for its search block.",
      "update  Updates Goodfellow, and blocks from its registry, if the site still builds.",
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
