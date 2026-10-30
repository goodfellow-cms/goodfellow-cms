import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  buildNotes,
  CLOUDFLARE_REDIRECTS_LIMIT,
  ContentError,
  formatUpdateResult,
  TASK_RESULT_FILE,
} from "@goodfellow-cms/core";
import { reportSiteProblems } from "@goodfellow-cms/core/accessibility";
import {
  AdminSetupError,
  addBroker,
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
  TASK_DESCRIPTION_FILE,
  update,
} from "@goodfellow-cms/core/node";
import { writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { blockWorks, formatShadcnBlock, ShadcnBlockError, TYPESCRIPT_VERSION } from "@goodfellow-cms/core/shadcn";
import { WordPressReadError } from "@goodfellow-cms/core/wordpress";
import { addBlock } from "./blocks.js";
import { siteBackend } from "./broker.js";
import { build, islandsSummary } from "./build.js";
import { dev } from "./dev.js";
import { preview } from "./preview.js";
import { buildCause, reportBuildCause } from "./problems.js";
import { SiteSetupError } from "./site.js";
import { describeTask, runTask } from "./task.js";

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
            sets the step's due output to true or false, or adds it to --output
  nightly   Say whether tonight's build is needed: when the site has changed since
            the live site was built, what it shows by today's date has, or an update
            is available (--mode, or GOODFELLOW_NIGHTLY: changed, the default,
            always or off); on GitHub Actions it sets the step's build and update
            outputs to true or false
  import    import wordpress <file or address>  brings a WordPress site's pages, posts,
                                   categories, tags, menus and media into this site,
                                   from its export file (Tools → Export) or its address
  export    export wordpress [file]  writes this site as a WordPress export file, which
                                   WordPress imports with Tools → Import → WordPress
  blocks    blocks add <item>      installs a shadcn registry item (button, @acme/hero, or
                                   an item's address) with shadcn's own CLI, makes a block
                                   of its component, with fields from its props, and says
                                   what it couldn't do; with --registry <folder>, writes
                                   the block into a block registry there instead; with
                                   --native <folder>, also makes its version for the Expo
                                   app there, with shadcn-tamagui-codemod. Needs
                                   TypeScript ${TYPESCRIPT_VERSION} (npm install --save-dev typescript@${TYPESCRIPT_VERSION})
  broker    The site's token broker, a sign-in page on an address of its own:
            broker add [folder]    writes its repository into folder (default: beside
                                   the site, named after it with -signin), for --host
                                   (github-pages, gitlab-pages, cloudflare-pages or
                                   vercel), with --domain for one of its own
            broker use <address>   signs in there from now on, once it's online
            broker remove          stops using it
  admin     The admin panel's address of its own, such as admin.example.org, for sites
            whose config the admin panel can't publish, such as those whose content
            is kept in a repository of its own:
            admin add <address>    names it in goodfellow.config.tsx
            admin check            checks it once the site has rebuilt with it, then
                                   starts the admin panel only there
            admin remove           stops using it
  task      Run one of a plugin's tasks for the admin panel, as the site's task
            workflow or pipeline does, with the request in GOODFELLOW_TASK_REQUEST,
            GOODFELLOW_TASK_PLUGIN, GOODFELLOW_TASK_NAME, GOODFELLOW_TASK_INPUT and
            GOODFELLOW_TASK_KEY, writing its sealed answer to --out (default:
            goodfellow-task-result.json). With --describe, it only loads the
            site's config and writes down the task to --out (default:
            goodfellow-task.json), for a job with no secrets, which the job with
            them runs with @goodfellow-cms/core's goodfellow-task
  content   For a site whose content is kept in a repository of its own:
            content link [folder]  links content/ and public/media/ to the content
                                   repository in folder (default: content-repository)
            content copy [folder]  copies them from it instead, as builds do

Options:
  --root <dir>    The site's folder (default: current folder)
  --out <dir>     Build output folder (default: dist); for task, the answer's file
  --base <path>   Serve the site from a subfolder, such as /my-repo/ (also GOODFELLOW_BASE)
  --port <port>   Port for dev or preview
  --network       For preview: let other computers on the network see it
  --to <release>  For update: fixes (the default), automatic (fixes, unless
                  content/updates.json turns them off), latest, or a release
                  such as 0.5.0; an older one goes back to it and skips this one
  --publish       For update: publish the update to the site's main branch once it builds
  --commit        For update: commit the update once it builds, without publishing it,
                  for a job that runs none of the site's code to publish
  --host <host>   For broker add: where the sign-in page is put online
  --domain <name> For broker add: the sign-in page's own domain, such as signin.example.org
  --since <time>  For due: when the last check started, such as 2026-11-29T09:17:00Z
  --mode <mode>   For nightly: changed (build only when something changed), always or off
  --output <file> For nightly: add build=… and update=… to file, as GitHub Actions' outputs;
                  for due: add due=…
  --strict        For build: fail if the site checks find links to pages or media that don't exist
  --react         For build: run Client Components with React even where they all work with Preact,
                  as GOODFELLOW_REACT=1 does
  --dry-run       For import: say what importing would bring across, and change nothing
  --describe      For task: only write down the task, for the job with the secrets
  --registry <dir>
                  For blocks add: write the block into the block registry in dir
  --native <dir>  For blocks add: also make the block's version for the Expo app in dir
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
      mode: { type: "string" },
      output: { type: "string" },
      host: { type: "string" },
      domain: { type: "string" },
      strict: { type: "boolean" },
      describe: { type: "boolean" },
      react: { type: "boolean" },
      network: { type: "boolean" },
      "dry-run": { type: "boolean" },
      registry: { type: "string" },
      native: { type: "string" },
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
        result = await build({ root: values.root, outDir: values.out, base, ...(values.react && { react: true }) });
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
      if (result.apiPages !== undefined) console.log(`Wrote the content API, with ${result.apiPages} pages, in api/`);
      if (result.islands) console.log(islandsSummary(result.islands));
      if (result.nextChange) {
        const { kind, title, path, time } = result.nextChange;
        console.log(
          `Next scheduled change: ${kind} "${title}"${path ? ` (${path})` : ""} at ${time}, which needs the site built again`,
        );
      }
      if (result.currentUntil) {
        console.log(
          `What the site shows by today's date changes at ${result.currentUntil}, when it needs building again`,
        );
      }
      if (result.redirectsLeft) {
        console.log(
          `Cloudflare Pages reads only the first ${CLOUDFLARE_REDIRECTS_LIMIT.toLocaleString("en")} lines of _redirects, so ${result.redirectsLeft} old address${result.redirectsLeft === 1 ? " is" : "es are"} left to the pages that send visitors on.`,
        );
      }
      for (const line of buildNotes(result)) console.log(line);
      for (const line of reportSiteProblems(result.problems)) console.log(line);
      if (values.strict && result.problems.some((problem) => problem.severity === "error")) {
        console.log("The build failed because of the site checks' errors (--strict).");
        process.exitCode = 1;
      }
      return;
    }
    case "task": {
      const env = process.env;
      if (values.describe) {
        await describeTask({
          root: values.root ?? ".",
          plugin: env.GOODFELLOW_TASK_PLUGIN ?? "",
          task: env.GOODFELLOW_TASK_NAME ?? "",
          out: values.out ?? TASK_DESCRIPTION_FILE,
        });
        return;
      }
      await runTask({
        root: values.root ?? ".",
        request: env.GOODFELLOW_TASK_REQUEST ?? "",
        plugin: env.GOODFELLOW_TASK_PLUGIN ?? "",
        task: env.GOODFELLOW_TASK_NAME ?? "",
        input: env.GOODFELLOW_TASK_INPUT ?? "",
        key: env.GOODFELLOW_TASK_KEY ?? "",
        out: values.out ?? TASK_RESULT_FILE,
      });
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
      for (const line of await reportDue(result, process.env, values.output ?? process.env.GITHUB_OUTPUT)) {
        console.log(line);
      }
      return;
    }
    case "nightly": {
      const result = await nightlyCheck({ root: values.root, ...(values.mode && { mode: values.mode }) });
      for (const line of await reportNightly(result, values.output ?? process.env.GITHUB_OUTPUT)) console.log(line);
      return;
    }
    case "blocks": {
      const [, action, item] = positionals;
      if (action !== "add" || !item) {
        console.error(`Say "blocks add" and the shadcn item, such as button or @acme/hero.\n\n${HELP}`);
        process.exitCode = 1;
        return;
      }
      const result = await addBlock({
        root: values.root,
        item,
        ...(values.registry && { registry: values.registry }),
        ...(values.native && { native: values.native }),
      });
      console.log(formatShadcnBlock(result));
      if (!blockWorks(result)) process.exitCode = 1;
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
    case "admin": {
      const [, action, argument] = positionals;
      const root = values.root ?? ".";
      if (!(action === "add" && argument) && action !== "check" && action !== "remove") {
        console.error(`Say "admin add <address>", "admin check" or "admin remove".\n\n${HELP}`);
        process.exitCode = 1;
        return;
      }
      const result =
        action === "check"
          ? await checkSiteAdminAddress(root)
          : await setAdminAddress(root, argument && action === "add" ? argument : undefined);
      const { lines, ok } = formatAdminResult(action, result);
      for (const line of lines) (ok ? console.log : console.error)(line);
      if (!ok) process.exitCode = 1;
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
      await preview({ root: values.root, outDir: values.out, base, port, ...(values.network && { network: true }) });
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
    error instanceof AdminSetupError ||
    error instanceof WordPressReadError ||
    error instanceof ShadcnBlockError
  ) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
