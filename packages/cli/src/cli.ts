import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CLOUDFLARE_REDIRECTS_LIMIT, ContentError, formatUpdateResult } from "@goodfellow-cms/core";
import { reportSiteProblems } from "@goodfellow-cms/core/accessibility";
import {
  addBroker,
  BrokerSetupError,
  ContentRepositoryError,
  contentRepositoryProblem,
  exportWordPress,
  formatWordPressExport,
  formatWordPressImport,
  importWordPress,
  reportDue,
  scheduleDue,
  setBrokerAddress,
  setUpContentRepository,
  update,
} from "@goodfellow-cms/core/node";
import { writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { WordPressReadError } from "@goodfellow-cms/core/wordpress";
import { siteBackend } from "./broker.js";
import { build } from "./build.js";
import { dev } from "./dev.js";
import { preview } from "./preview.js";
import { buildCause, reportBuildCause } from "./problems.js";
import { SiteSetupError } from "./site.js";

const BROKER_HOSTS = ["github-pages", "gitlab-pages", "cloudflare-pages", "vercel"] as const;

const HELP = `Usage: goodfellow <command> [options]

Commands:
  dev       Start a development server that re-renders pages as you edit
  build     Build the static site into dist/
  preview   Serve the built site the way a static host would
  index     Index a built site's pages for its search block (build does this itself)
  update    Update Goodfellow, and blocks from its registry, if the site still builds
  due       Say whether a scheduled change has come due since --since (default: the
            last hour), so the site needs building again; on GitHub Actions it also
            sets the step's due output to true or false
  import    import wordpress <file or address>  brings a WordPress site's pages, posts,
                                   categories, tags, menus and media into this site,
                                   from its export file (Tools → Export) or its address
  export    export wordpress [file]  writes this site as a WordPress export file, which
                                   WordPress imports with Tools → Import → WordPress
  broker    The site's token broker, a sign-in page on an address of its own:
            broker add [folder]    writes its repository into folder (default: beside
                                   the site, named after it with -signin), for --host
                                   (github-pages, gitlab-pages, cloudflare-pages or
                                   vercel), with --domain for one of its own
            broker use <address>   signs in there from now on, once it's online
            broker remove          stops using it
  content   For a site whose content is kept in a repository of its own:
            content link [folder]  links content/ and public/media/ to the content
                                   repository in folder (default: content-repository)
            content copy [folder]  copies them from it instead, as builds do

Options:
  --root <dir>    The site's folder (default: current folder)
  --out <dir>     Build output folder (default: dist)
  --base <path>   Serve the site from a subfolder, such as /my-repo/ (also GOODFELLOW_BASE)
  --port <port>   Port for dev or preview
  --to <release>  For update: fixes (the default), automatic (fixes, unless
                  content/updates.json turns them off), latest, or a release
                  such as 0.5.0; an older one goes back to it and skips this one
  --publish       For update: publish the update to the site's main branch once it builds
  --commit        For update: commit the update once it builds, without publishing it,
                  for a job that runs none of the site's code to publish
  --host <host>   For broker add: where the sign-in page is put online
  --domain <name> For broker add: the sign-in page's own domain, such as signin.example.org
  --since <time>  For due: when the last check started, such as 2026-11-29T09:17:00Z
  --strict        For build: fail if the site checks find links to pages or media that don't exist
  --dry-run       For import: say what importing would bring across, and change nothing
  -h, --help      Show this help
`;

/** A site whose content is kept in a repository of its own needs it put in place first. */
function checkContent(root: string): void {
  const problem = contentRepositoryProblem(root);
  if (problem) throw new SiteSetupError(problem);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      out: { type: "string" },
      base: { type: "string" },
      port: { type: "string" },
      to: { type: "string" },
      publish: { type: "boolean" },
      commit: { type: "boolean" },
      since: { type: "string" },
      host: { type: "string" },
      domain: { type: "string" },
      strict: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command] = positionals;
  const port = values.port ? Number(values.port) : undefined;
  const base = values.base ?? process.env.GOODFELLOW_BASE;

  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  if (command === "dev" || command === "build" || command === "due" || command === "import" || command === "export")
    checkContent(values.root ?? ".");

  switch (command) {
    case "dev":
      await dev({ root: values.root, port });
      return;
    case "build": {
      const started = performance.now();
      let result: Awaited<ReturnType<typeof build>>;
      try {
        result = await build({ root: values.root, outDir: values.out, base });
      } catch (error) {
        // For the admin panel, which reads it in the host's log to explain the failure.
        for (const line of reportBuildCause(buildCause(error, resolve(values.root ?? ".")))) console.log(line);
        throw error;
      }
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      console.log(
        `Built ${result.pages.length} page${result.pages.length === 1 ? "" : "s"} into ${result.outDir} in ${seconds}s`,
      );
      if (result.searchIndexed !== undefined) console.log(`Indexed ${result.searchIndexed} pages for search`);
      if (result.nextChange) {
        const { kind, title, path, time } = result.nextChange;
        console.log(
          `Next scheduled change: ${kind} "${title}"${path ? ` (${path})` : ""} at ${time}, which needs the site built again`,
        );
      }
      if (result.redirectsLeft) {
        console.log(
          `Cloudflare Pages reads only the first ${CLOUDFLARE_REDIRECTS_LIMIT.toLocaleString("en")} lines of _redirects, so ${result.redirectsLeft} old address${result.redirectsLeft === 1 ? " is" : "es are"} left to the pages that send visitors on.`,
        );
      }
      for (const line of reportSiteProblems(result.problems)) console.log(line);
      if (values.strict && result.problems.some((problem) => problem.severity === "error")) {
        console.log("The build failed because of the site checks' errors (--strict).");
        process.exitCode = 1;
      }
      return;
    }
    case "index": {
      const dir = positionals[1] ?? values.out ?? "out";
      const indexed = await writeSearchIndex(dir);
      console.log(
        indexed === undefined
          ? `No page in ${dir} has a search block, so there's nothing to index`
          : `Indexed ${indexed} pages for search`,
      );
      return;
    }
    case "update": {
      const result = await update({ root: values.root, to: values.to, publish: values.publish, commit: values.commit });
      // For the admin panel, which reads it in the host's log.
      console.log(formatUpdateResult(result));
      if (result.state === "failed") process.exitCode = 1;
      return;
    }
    case "due": {
      const result = await scheduleDue({ root: values.root, since: values.since });
      for (const line of await reportDue(result)) console.log(line);
      return;
    }
    case "broker": {
      const [, action, argument] = positionals;
      const root = values.root ?? ".";
      if (action === "add") {
        const host = BROKER_HOSTS.find((candidate) => candidate === values.host);
        if (!host) {
          console.error(`Say where to put it online with --host: ${BROKER_HOSTS.join(", ")}.\n\n${HELP}`);
          process.exitCode = 1;
          return;
        }
        const added = await addBroker(root, {
          source: await siteBackend(root),
          host,
          ...(values.domain && { domain: values.domain }),
          ...(argument && { folder: argument }),
        });
        const shown = relative(process.cwd(), added.folder) || ".";
        console.log(
          `Wrote the sign-in page's repository to ${shown}${added.committed ? ", with everything in a first commit" : ""}. Push it to a repository of its own, put it online as its README says, then run "goodfellow broker use <its address>".`,
        );
        return;
      }
      if (action === "use" && argument) {
        const address = await setBrokerAddress(root, argument);
        console.log(`Editors sign in at ${address} once the site has rebuilt with goodfellow.config.tsx.`);
        return;
      }
      if (action === "remove") {
        await setBrokerAddress(root, undefined);
        console.log("Editors sign in in the admin panel itself once the site has rebuilt with goodfellow.config.tsx.");
        return;
      }
      console.error(`Say "broker add", "broker use <address>" or "broker remove".\n\n${HELP}`);
      process.exitCode = 1;
      return;
    }
    case "content": {
      const [, action, from] = positionals;
      if (action !== "link" && action !== "copy") {
        console.error(`Say "content link" or "content copy".\n\n${HELP}`);
        process.exitCode = 1;
        return;
      }
      const folder = await setUpContentRepository(values.root ?? ".", { from, copy: action === "copy" });
      const shown = relative(process.cwd(), folder) || ".";
      console.log(
        action === "copy"
          ? `Copied content/ and public/media/ from ${shown}`
          : `Linked content/ and public/media/ to ${shown}, so the site's content is the content repository's`,
      );
      return;
    }
    case "import": {
      const [, kind, from] = positionals;
      if (kind !== "wordpress" || !from) {
        console.error(`Say "import wordpress" and the export file or the site's address.\n\n${HELP}`);
        process.exitCode = 1;
        return;
      }
      const result = await importWordPress(values.root ?? ".", from, {
        dryRun: values["dry-run"],
        log: (line) => console.log(line),
      });
      console.log(formatWordPressImport(result));
      return;
    }
    case "export": {
      const [, kind, file] = positionals;
      if (kind !== "wordpress") {
        console.error(`Say "export wordpress", and the file to write if you like.\n\n${HELP}`);
        process.exitCode = 1;
        return;
      }
      console.log(formatWordPressExport(await exportWordPress(values.root ?? ".", file)));
      return;
    }
    case "preview":
      await preview({ root: values.root, outDir: values.out, base, port });
      return;
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof ContentError) {
    console.error(
      `\nSome content files have problems:\n${error.problems.map((p) => `  ${p.file}: ${p.message}`).join("\n")}\n`,
    );
  } else if (
    error instanceof SiteSetupError ||
    error instanceof ContentRepositoryError ||
    error instanceof BrokerSetupError ||
    error instanceof WordPressReadError
  ) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
