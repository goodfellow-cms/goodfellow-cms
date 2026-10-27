#!/usr/bin/env node
// After `next build`: `goodfellow-next finish out` fixes the export's prefetch files on Windows,
// writes the calendar files of collections of events, collections' feeds, the pages at redirects' old addresses and Cloudflare Pages' _redirects, and the search index for sites with a search block,
// copies the site's Google Fonts into the export, builds plugins' admin frames and runs their build steps, starts every page with the admin address's guard for a site with one, and reports what automated checks find on the exported pages. `index` only writes the index.
// `goodfellow-next update` updates Goodfellow, as `goodfellow update` does for other sites.
// `goodfellow-next task [--out <file>]` runs one of a plugin's tasks for the admin panel, as `goodfellow task` does.
// `goodfellow-next due [--since <time>] [--output <file>]` says whether a scheduled change has come due, as `goodfellow due` does.
// `goodfellow-next nightly [--mode <mode>]` says whether tonight's build is needed, as `goodfellow nightly` does.
// `goodfellow-next content link|copy [folder]` puts a content repository's files in place, for a site whose
// content is kept in a repository of its own.
// `goodfellow-next import wordpress <file or address> [--dry-run]` imports a WordPress site, as `goodfellow import` does.
// `goodfellow-next export wordpress [file]` writes the site as a WordPress export file, as `goodfellow export` does.
// `goodfellow-next blocks add <item> [--registry <folder>]` makes a block of a shadcn item, as `goodfellow blocks add` does.
// `goodfellow-next admin add <address>|check|remove` sets the admin address, and `goodfellow-next broker use <address>|remove`
// the token broker, in goodfellow.config.tsx, as `goodfellow admin` and `goodfellow broker` do.
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildNotes, CLOUDFLARE_REDIRECTS_LIMIT, configAdmin, formatUpdateResult } from "@goodfellow-cms/core";
import { reportSiteProblems } from "@goodfellow-cms/core/accessibility";
import {
  AdminSetupError,
  BrokerSetupError,
  ContentRepositoryError,
  checkSiteAdminAddress,
  contentRepositoryProblem,
  exportWordPress,
  formatAdminResult,
  formatWordPressExport,
  formatWordPressImport,
  importWordPress,
  nightlyCheck,
  reportDue,
  reportNightly,
  scheduleDue,
  setAdminAddress,
  setBrokerAddress,
  setUpContentRepository,
  update,
} from "@goodfellow-cms/core/node";
import { writePagesSearchIndex, writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { addShadcnBlock, blockWorks, formatShadcnBlock, ShadcnBlockError } from "@goodfellow-cms/core/shadcn";
import { WordPressReadError } from "@goodfellow-cms/core/wordpress";
import {
  blockPageRender,
  buildFileFolders,
  builtPages,
  checkPages,
  exportedPages,
  fixSegmentFiles,
  guardExport,
  NEXT_SITE_FILES,
  writeBuildRecordFile,
  writeCalendarFiles,
  writeContentApi,
  writeEditorPolicy,
  writeFeedFiles,
  writeFontFiles,
  writePageLanguages,
  writePluginFiles,
  writeRedirectFiles,
  writeTaskResult,
} from "@goodfellow-cms/next/export";

const [command, dir = "out"] = process.argv.slice(2);
const CONFIG_FILES = ["goodfellow.config.tsx", "goodfellow.config.ts", "goodfellow.config.jsx", "goodfellow.config.js"];
// A full-stack site (withGoodfellow(config, { server: true })): Next.js serves its pages and sends redirects
// itself, so the calendar files, feeds and the search index are written into public/, which `next start` and hosts
// serve as static files, as they are for an export.
if (command === "finish" && dir === "--server") {
  // Next.js renders a full-stack site's pages as it serves them, so nothing can put a guard first in each.
  const config = CONFIG_FILES.find((file) => existsSync(file));
  if (config && configAdmin(readFileSync(config, "utf8"))) {
    console.error(
      "A full-stack site can't have an admin address: its admin panel signs in with the site's own sign-in.",
    );
    process.exit(1);
  }
  for (const folder of await buildFileFolders()) await rm(`public/${folder}`, { recursive: true, force: true });
  // The editor's frames' page, which next start serves as it was rendered.
  await writeEditorPolicy(".next/server/app");
  const calendars = await writeCalendarFiles("public");
  if (calendars > 0) console.log(`Wrote ${calendars} calendar files, in public/calendars`);
  const feeds = await writeFeedFiles("public");
  if (feeds > 0) console.log(`Wrote ${feeds} feeds, in public/feeds`);
  const api = await writeContentApi("public");
  if (api !== undefined) console.log(`Wrote the content API, with ${api} pages, in public/api`);
  // Before the pages are read, so the search index and the checks see each page's language.
  const languages = await writePageLanguages(undefined);
  if (languages > 0) console.log(`Marked ${languages} pages with their language`);
  // Plugins' admin frames and build steps, into public/, which next start serves.
  const plugins = await writePluginFiles("public");
  if (plugins.frames.length > 0)
    console.log(`Wrote the admin frames of ${plugins.frames.join(", ")}, in public/admin/plugins`);
  const pages = await builtPages();
  const indexed = await writePagesSearchIndex(pages, "public/pagefind");
  console.log(
    indexed === undefined
      ? "No page has a search block, so there's nothing to index"
      : `Indexed ${indexed} pages for search, in public/pagefind`,
  );
  for (const line of reportSiteProblems(await checkPages(pages))) console.log(line);
  process.exit(0);
}
if (command === "update") {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { to: { type: "string" }, publish: { type: "boolean" }, commit: { type: "boolean" } },
  });
  // The starter's admin pages, kept up to date where nobody has changed them, on sites with an admin panel.
  const siteFiles = existsSync("app/admin/page.tsx") ? NEXT_SITE_FILES : [];
  const result = await update({ to: values.to, publish: values.publish, commit: values.commit, siteFiles });
  // For the admin panel, which reads it in the host's log.
  console.log(formatUpdateResult(result));
  process.exit(result.state === "failed" ? 1 : 0);
}
if (command === "task") {
  const { values } = parseArgs({ args: process.argv.slice(3), options: { out: { type: "string" } } });
  const env = process.env;
  await writeTaskResult(
    ".",
    {
      id: env.GOODFELLOW_TASK_REQUEST ?? "",
      plugin: env.GOODFELLOW_TASK_PLUGIN ?? "",
      task: env.GOODFELLOW_TASK_NAME ?? "",
      input: env.GOODFELLOW_TASK_INPUT ?? "",
      key: env.GOODFELLOW_TASK_KEY ?? "",
    },
    values.out,
  );
  process.exit(0);
}
if (command === "due") {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { since: { type: "string" }, output: { type: "string" } },
  });
  const result = await scheduleDue({ since: values.since });
  for (const line of await reportDue(result, process.env, values.output ?? process.env.GITHUB_OUTPUT))
    console.log(line);
  process.exit(0);
}
if (command === "nightly") {
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { mode: { type: "string" }, output: { type: "string" } },
  });
  const siteFiles = existsSync("app/admin/page.tsx") ? NEXT_SITE_FILES : [];
  const result = await nightlyCheck({ siteFiles, ...(values.mode && { mode: values.mode }) });
  for (const line of await reportNightly(result, values.output ?? process.env.GITHUB_OUTPUT)) console.log(line);
  process.exit(0);
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
if (command === "admin" || command === "broker") {
  const [action, argument] = process.argv.slice(3);
  try {
    if (command === "admin" && ((action === "add" && argument) || action === "check" || action === "remove")) {
      const result =
        action === "check"
          ? await checkSiteAdminAddress(".")
          : await setAdminAddress(".", action === "add" ? argument : undefined);
      const { lines, ok } = formatAdminResult(action, result, "goodfellow-next");
      for (const line of lines) (ok ? console.log : console.error)(line);
      process.exit(ok ? 0 : 1);
    }
    if (command === "broker" && ((action === "use" && argument) || action === "remove")) {
      const address = await setBrokerAddress(".", action === "use" ? argument : undefined);
      console.log(
        address
          ? `Editors sign in at ${address} once the site has rebuilt with goodfellow.config.tsx.`
          : "Editors sign in in the admin panel itself once the site has rebuilt with goodfellow.config.tsx.",
      );
      process.exit(0);
    }
  } catch (error) {
    if (!(error instanceof AdminSetupError || error instanceof BrokerSetupError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
if (command === "import") {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: { "dry-run": { type: "boolean" } },
  });
  const [kind, from] = positionals;
  const problem = contentRepositoryProblem(".");
  if (kind === "wordpress" && from && !problem) {
    try {
      const result = await importWordPress(".", from, { dryRun: values["dry-run"], log: (line) => console.log(line) });
      console.log(formatWordPressImport(result));
      process.exit(0);
    } catch (error) {
      if (!(error instanceof WordPressReadError)) throw error;
      console.error(error.message);
      process.exit(1);
    }
  }
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
if (command === "export") {
  const [kind, file] = process.argv.slice(3);
  const problem = contentRepositoryProblem(".");
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  if (kind === "wordpress") {
    console.log(formatWordPressExport(await exportWordPress(".", file)));
    process.exit(0);
  }
}
if (command === "blocks") {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(3),
    allowPositionals: true,
    options: { registry: { type: "string" } },
  });
  const [action, item] = positionals;
  if (action === "add" && item) {
    try {
      const result = await addShadcnBlock({
        root: process.cwd(),
        item,
        ...(values.registry && { registry: resolve(values.registry) }),
        render: blockPageRender("."),
      });
      console.log(formatShadcnBlock(result));
      process.exit(blockWorks(result) ? 0 : 1);
    } catch (error) {
      if (!(error instanceof ShadcnBlockError)) throw error;
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
      "       goodfellow-next update [--to fixes|automatic|latest|<release>] [--publish | --commit]",
      "       goodfellow-next due [--since <time>] [--output <file>]",
      "       goodfellow-next nightly [--mode changed|always|off] [--output <file>]",
      "       goodfellow-next content link|copy [folder]",
      "       goodfellow-next import wordpress <file or address> [--dry-run]",
      "       goodfellow-next export wordpress [file]",
      "       goodfellow-next blocks add <item> [--registry <folder>]",
      "       goodfellow-next admin add <address> | check | remove",
      "       goodfellow-next broker use <address> | remove",
      "",
      "finish  Gets the exported site in folder (default: out) ready to publish: puts the files",
      "        Next.js uses to load pages ahead where browsers look for them, writes calendar files",
      "        for collections of events, collections' feeds and pages that send visitors on from",
      "        old addresses, builds plugins' admin frames and runs their build steps, indexes it",
      "        for search, and lists what automated accessibility checks",
      "        find on its pages. With --server, for a full-stack site, writes the calendar files",
      "        and feeds into public/calendars and public/feeds and indexes and checks the pages",
      "        next build rendered, with the index in public/pagefind, instead.",
      "index   Only indexes the exported site for its search block.",
      "update  Updates Goodfellow, and blocks from its registry, if the site still builds.",
      "        --publish pushes it to the main branch; --commit only commits it, for a job",
      "        that runs none of the site's code to publish.",
      "due     Says whether a scheduled change has come due since --since (default: the last",
      "        hour), so the site needs building again, and sets the step's due output on",
      "        GitHub Actions, or adds it to --output.",
      "nightly Says whether tonight's build is needed: when the site has changed since the live",
      "        site was built, what it shows by today's date has, or an update is available",
      "        (--mode, or GOODFELLOW_NIGHTLY: changed, the default, always or off), and sets the",
      "        step's build and update outputs on GitHub Actions, or adds them to --output.",
      "content For a site whose content is kept in a repository of its own: links content/ and",
      "        public/media/ to the content repository in folder (default: content-repository),",
      "        or copies them from it, as builds do.",
      "import  Brings a WordPress site's pages, posts, categories, tags, menus and media into",
      "        this site, from its export file (Tools → Export) or its address. With --dry-run,",
      "        says what it would bring across and changes nothing.",
      "export  Writes this site as a WordPress export file (default: named after the site),",
      "        which WordPress imports with Tools → Import → WordPress.",
      "blocks  Installs a shadcn registry item (button, @acme/hero, or an item's address) with",
      "        shadcn's own CLI, makes a block of its component, with fields from its props, and",
      "        says what it couldn't do. With --registry, writes the block into the block registry",
      "        in folder instead. Needs TypeScript 7 as typescript-7, since Next.js builds with 5:",
      "        npm install --save-dev typescript-7@npm:typescript@7.0.2",
      "admin   The admin panel's address of its own, such as admin.example.org, in",
      "        goodfellow.config.tsx: add names it; check checks it once the site has rebuilt with",
      "        it, then starts the admin panel only there; remove stops using it.",
      "broker  The site's token broker in goodfellow.config.tsx: use signs editors in there once",
      "        it's online; remove stops using it.",
    ].join("\n"),
  );
  process.exit(1);
}
/** What checking the exported pages found, reported once the export is ready. */
let problems = [];
if (command === "finish") {
  const moved = await fixSegmentFiles(dir);
  await writeEditorPolicy(dir);
  if (moved > 0) console.log(`Moved ${moved} of Next.js's prefetch files to where browsers look for them`);
  const calendars = await writeCalendarFiles(dir);
  if (calendars > 0) console.log(`Wrote ${calendars} calendar files`);
  const feeds = await writeFeedFiles(dir);
  if (feeds > 0) console.log(`Wrote ${feeds} feeds`);
  const api = await writeContentApi(dir);
  if (api !== undefined) console.log(`Wrote the content API, with ${api} pages, in api/`);
  const languages = await writePageLanguages(dir);
  if (languages > 0) console.log(`Marked ${languages} pages with their language`);
  // Before the redirects' pages, which aren't the site's.
  problems = await checkPages(await exportedPages(dir));
  const redirects = await writeRedirectFiles(dir);
  if (redirects.pages > 0) console.log(`Wrote ${redirects.pages} redirects`);
  if (redirects.cloudflareLeft > 0) {
    console.log(
      `Cloudflare Pages reads only the first ${CLOUDFLARE_REDIRECTS_LIMIT.toLocaleString("en")} lines of _redirects, so ${redirects.cloudflareLeft} old address${redirects.cloudflareLeft === 1 ? " is" : "es are"} left to the pages that send visitors on.`,
    );
  }
  for (const line of buildNotes(await writeFontFiles(dir))) console.log(line);
  // Plugins' admin frames and build steps, once Goodfellow has written the rest, before the index and the guards.
  const plugins = await writePluginFiles(dir);
  if (plugins.frames.length > 0) console.log(`Wrote the admin frames of ${plugins.frames.join(", ")}`);
  // What the site was built from, and when it stops being current, for the nightly check.
  const currentUntil = await writeBuildRecordFile(dir);
  if (currentUntil) {
    console.log(`What the site shows by today's date changes at ${currentUntil}, when it needs building again`);
  }
}
const indexed = await writeSearchIndex(dir);
console.log(
  indexed === undefined
    ? `No page in ${dir} has a search block, so there's nothing to index`
    : `Indexed ${indexed} pages for search`,
);
if (command === "finish") {
  const guarded = await guardExport(dir);
  if (guarded !== undefined) console.log(`Started ${guarded} pages with the admin address's guard`);
}
for (const line of reportSiteProblems(problems)) console.log(line);
