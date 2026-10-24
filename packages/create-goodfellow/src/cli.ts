import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatWordPressImport, importWordPress } from "@goodfellow-cms/core/node";
import { WordPressReadError } from "@goodfellow-cms/core/wordpress";
import {
  allowsAdminAddress,
  type Backend,
  BLOCK_CHOICES,
  type BlockChoice,
  type BrokerHost,
  brokerHostsFor,
  CONTENT_BUILDS,
  CONTENT_REPOSITORY_DIR,
  type CommitResult,
  type ContentBuild,
  commitAll,
  contentBuildsFor,
  contentRepositoryDir,
  type GitResult,
  HOSTS,
  type Host,
  hostsFor,
  initGitRepository,
  installPackages,
  parseRepo,
  ScaffoldError,
  type SeparateContent,
  scaffold,
  scaffoldBroker,
  TEMPLATES,
  type TemplateName,
} from "./scaffold.js";
import { type Choice, select } from "./select.js";

const HELP = `Creates a new Goodfellow site.

Usage: npm create goodfellow@latest [folder] -- [options]

Options:
  --template <name>   starter (the default), parish, or next for a Next.js site
  --github <repo>     The GitHub repository the site will be stored in, such as your-name/your-site
  --gitlab <project>  The GitLab project the site will be stored in, such as your-group/your-site
  --host <host>       github-pages, gitlab-pages, cloudflare-pages or vercel. Keeps only that
                      host's setup files (for Cloudflare Pages, a nightly update and rebuild)
  --content <repo>    Keeps the site's content in a repository of its own, such as
                      your-name/your-site-content; --github or --gitlab is then the code's
  --build <where>     With --content on Vercel: content (the default) or code, the
                      repository Vercel builds the site from
  --blocks <choice>   recommended (the default) to add the recommended blocks, or built-in for Goodfellow's own only
  --admin <address>   An admin address of its own for editors, such as https://admin.example.org,
                      where the host serves a site at more than one address (not GitHub Pages)
  --broker <host>     Also writes a sign-in page of its own, a token broker, into a folder beside
                      the site, for github-pages, gitlab-pages, cloudflare-pages or vercel
  --broker-domain <d> The sign-in page's own domain, such as signin.example.org (needed on GitHub Pages)
  --wordpress <from>  Brings a WordPress site's pages, posts, menus and media into the new site,
                      from its export file (Tools → Export) or its address
  --no-install        Don't run npm install
  --no-git            Don't make the site a git repository, or commit it
  -y, --yes           Don't ask anything: use the options given, and defaults for the rest
  -h, --help          Show this help
`;

/** Bundled into the package when it's built: see scripts/bundle-templates.mjs. */
const templatesDir = fileURLToPath(new URL("../templates/", import.meta.url));

const HOST_NAMES = { github: "GitHub", gitlab: "GitLab" } as const;

/** Asks one question. Each has its own interface, since menus read the terminal themselves in between. */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** A menu the arrow keys move through, or numbered choices where the output isn't a terminal. */
async function choose<T>(question: string, choices: Choice<T>[]): Promise<T> {
  stdout.write("\n");
  if (stdout.isTTY) return select(question, choices);
  stdout.write(`${question}\n`);
  choices.forEach((choice, index) => {
    stdout.write(`  ${index + 1}. ${choice.label}${choice.note ? `\n     ${choice.note}` : ""}\n`);
  });
  for (;;) {
    const answer = (await ask(`Choose 1-${choices.length} (1): `)).trim();
    const choice = choices[answer === "" ? 0 : Number(answer) - 1];
    if (choice) return choice.value;
  }
}

async function askRepo(host: Backend["host"]): Promise<string | undefined> {
  const example = host === "github" ? "your-name/your-site" : "your-group/your-site";
  for (;;) {
    const answer = await ask(
      `\nThe ${HOST_NAMES[host]} ${host === "github" ? "repository" : "project"}, such as ${example} (leave empty if it doesn't exist yet): `,
    );
    if (answer.trim() === "") return undefined;
    const repo = parseRepo(host, answer);
    if (repo) return repo;
    stdout.write(`That doesn't look like a ${HOST_NAMES[host]} address. Type it as ${example}.\n`);
  }
}

function isTemplate(name: string): name is TemplateName {
  return Object.hasOwn(TEMPLATES, name);
}

function isHost(name: string): name is Host {
  return Object.hasOwn(HOSTS, name);
}

function backendFromOptions(github: string | undefined, gitlab: string | undefined): Backend | undefined {
  if (github !== undefined && gitlab !== undefined) {
    throw new ScaffoldError("Choose either --github or --gitlab, not both.");
  }
  const host = github !== undefined ? "github" : gitlab !== undefined ? "gitlab" : undefined;
  if (!host) return undefined;
  const repo = parseRepo(host, (github ?? gitlab) as string);
  if (!repo) {
    throw new ScaffoldError(
      host === "github"
        ? "--github takes a repository such as your-name/your-site."
        : "--gitlab takes a project such as your-group/your-site.",
    );
  }
  return { host, repo };
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      template: { type: "string" },
      github: { type: "string" },
      gitlab: { type: "string" },
      host: { type: "string" },
      blocks: { type: "string" },
      content: { type: "string" },
      build: { type: "string" },
      wordpress: { type: "string" },
      admin: { type: "string" },
      broker: { type: "string" },
      "broker-domain": { type: "string" },
      "no-git": { type: "boolean" },
      "no-install": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    stdout.write(HELP);
    return;
  }

  let folder = positionals[0];
  let template = values.template;
  if (template !== undefined && !isTemplate(template)) {
    throw new ScaffoldError(`There's no template called "${template}". Choose ${Object.keys(TEMPLATES).join(" or ")}.`);
  }
  let backend = backendFromOptions(values.github, values.gitlab);
  let host: string | undefined = values.host;
  if (host !== undefined && !isHost(host)) {
    throw new ScaffoldError(`--host takes ${Object.keys(HOSTS).join(", ")}.`);
  }
  let blocks: string | undefined = values.blocks;
  if (blocks !== undefined && !(blocks in BLOCK_CHOICES)) {
    throw new ScaffoldError(`--blocks takes ${Object.keys(BLOCK_CHOICES).join(" or ")}.`);
  }
  let build = values.build;
  if (build !== undefined && !Object.hasOwn(CONTENT_BUILDS, build)) {
    throw new ScaffoldError(`--build takes ${Object.keys(CONTENT_BUILDS).join(" or ")}.`);
  }
  let contentRepo = values.content;
  let admin = values.admin;
  let broker: string | undefined = values.broker;
  let brokerDomain = values["broker-domain"];

  if (stdin.isTTY && !values.yes) {
    if (!folder) folder = (await ask("Folder for the new site (my-site): ")).trim() || "my-site";
    template ??= await choose(
      "Start from:",
      Object.entries(TEMPLATES).map(([value, { label, description }]) => ({
        value: value as TemplateName,
        label,
        note: description,
      })),
    );
    let storage = backend?.host;
    if (!backend) {
      storage = await choose<Backend["host"] | undefined>(
        "Where will the site be stored? Editors sign in there, and publishing saves to it.",
        [
          { value: "github", label: "GitHub" },
          { value: "gitlab", label: "GitLab" },
          { value: undefined, label: "Not decided yet" },
        ],
      );
      const repo = storage && (await askRepo(storage));
      if (storage && repo) backend = { host: storage, repo };
    }
    host ??= await chooseHost(storage);
    if (backend && host && contentRepo === undefined) {
      const separate = await choose("Where should the site's content be kept?", [
        { value: false, label: "With the code", note: "One repository for everything." },
        {
          value: true,
          label: "In a repository of its own",
          note: "Editors can change the content but never the code. For organizations with a developer.",
        },
      ]);
      if (separate) contentRepo = await askContentRepo(backend);
    }
    if (contentRepo !== undefined && host && build === undefined && contentBuildsFor(host as Host).length > 1) {
      build = await choose(
        `Which repository should ${HOSTS[host as Host].label} build the site from?`,
        contentBuildsFor(host as Host)
          .toReversed()
          .map((value) => ({ value, label: CONTENT_BUILDS[value].label, note: CONTENT_BUILDS[value].description })),
      );
    }
    if (backend && admin === undefined && broker === undefined) {
      const signIn = await chooseSignIn(backend, host as Host | undefined);
      if (signIn === "admin") admin = await askAddress("The admin address, such as https://admin.example.org: ");
      if (signIn === "broker") {
        broker = await choose(
          "Where should the sign-in page be put online?",
          brokerHostsFor(backend.host).map((value) => ({ value, label: BROKER_HOSTS[value] })),
        );
        if (broker === "github-pages") brokerDomain = await askDomain();
      }
    }
    blocks ??= await choose(
      "Which blocks should the editor offer to start with?",
      Object.entries(BLOCK_CHOICES).map(([value, { label, description }]) => ({
        value: value as BlockChoice,
        label,
        note: description,
      })),
    );
  }

  if (!folder) {
    throw new ScaffoldError("Say which folder to create the site in, such as: npm create goodfellow@latest my-site");
  }
  if (host && backend && !hostsFor(backend.host).includes(host as Host)) {
    throw new ScaffoldError(`${HOSTS[host as Host].label} can't serve a site stored on ${HOST_NAMES[backend.host]}.`);
  }

  const content = contentRepo === undefined ? undefined : separateContent(contentRepo, build, backend, host);
  if (admin !== undefined && !allowsAdminAddress(host as Host | undefined)) {
    throw new ScaffoldError(
      "An admin address needs a host that serves a site at more than one address (--host gitlab-pages, cloudflare-pages or vercel).",
    );
  }
  if (broker !== undefined) {
    if (!backend) throw new ScaffoldError("A sign-in page needs the site's repository (--github or --gitlab).");
    if (!brokerHostsFor(backend.host).includes(broker as BrokerHost)) {
      throw new ScaffoldError(
        `--broker takes ${brokerHostsFor(backend.host).join(", ")} for a site on ${HOST_NAMES[backend.host]}.`,
      );
    }
  }

  const target = resolve(folder);
  const versions = JSON.parse(readFileSync(join(templatesDir, "versions.json"), "utf8")) as Record<string, string>;
  await scaffold({
    template: join(templatesDir, template ?? "starter"),
    target,
    versions,
    ...(backend && { backend }),
    ...(host && { host: host as Host }),
    ...((blocks ?? "recommended") === "recommended" && { registryDir: join(templatesDir, "registry") }),
    ...(content && { content }),
    ...(admin && { admin }),
  });
  const brokerTarget = broker && backend ? `${target}-signin` : undefined;
  if (brokerTarget && backend) {
    await scaffoldBroker({
      release: join(templatesDir, "broker"),
      target: brokerTarget,
      backend,
      host: broker as BrokerHost,
      ...(brokerDomain && { domain: brokerDomain }),
    });
  }

  // The content repository first: inside the code's repository, git would count it as part of it.
  const contentDir = contentRepositoryDir(target);
  // Imported before the first commit, so the site starts with the WordPress site's content.
  let imported: string[] = [];
  if (values.wordpress) {
    stdout.write("\nImporting the WordPress site...\n");
    try {
      imported = formatWordPressImport(await importWordPress(content ? contentDir : target, values.wordpress)).split(
        "\n",
      );
    } catch (error) {
      if (!(error instanceof WordPressReadError)) throw error;
      imported = [`The WordPress site couldn't be imported: ${error.message}`];
    }
  }
  const contentGit =
    content && backend && !values["no-git"]
      ? initGitRepository(contentDir, { host: backend.host, repo: content.repo })
      : undefined;
  const contentCommit = contentGit?.created ? commitAll(contentDir, "Create the site's content") : undefined;
  const brokerGit = brokerTarget && !values["no-git"] ? initGitRepository(brokerTarget) : undefined;
  const brokerCommit = brokerGit?.created && brokerTarget ? commitAll(brokerTarget, "Add the sign-in page") : undefined;
  const git = values["no-git"] ? undefined : initGitRepository(target, backend);
  let installed = false;
  if (!values["no-install"]) {
    stdout.write("\nInstalling the site's packages with npm...\n\n");
    installed = installPackages(target);
  }
  // The first commit includes package-lock.json, which the deploy setups need, so it waits for npm install.
  const commit: CommitResult | undefined =
    git?.created && (installed || values["no-install"]) ? commitAll(target, "Create the site") : undefined;

  const where = relative(process.cwd(), target) || ".";
  const cd = where === "." ? [] : [`  cd ${/\s/.test(where) ? JSON.stringify(where) : where}`];
  const lines = [
    "",
    `Created a new site in ${where}.`,
    ...(git ? gitLines(git, commit, installed) : []),
    ...(content ? contentLines(content, contentGit, contentCommit) : []),
    ...(admin
      ? [
          content
            ? `Editors will sign in at ${admin} once "npx ${template === "next" ? "goodfellow-next" : "goodfellow"} admin check" has checked it: see README.md.`
            : `Editors will sign in at ${admin} once the Domain screen has checked it: see README.md.`,
        ]
      : []),
    ...(brokerTarget
      ? [
          `Its sign-in page is in ${relative(process.cwd(), brokerTarget)}${brokerCommit === "committed" ? ", a git repository with everything in its first commit" : ""}. Push it to a repository of its own and put it online as its README says, then set its address on Site Settings → Security.`,
        ]
      : []),
    ...(imported.length > 0 ? ["", ...imported] : []),
    ...(!installed && !values["no-install"]
      ? ["npm install didn't finish, so run it again in the site's folder."]
      : []),
    "",
    "Next:",
    ...cd,
    ...(installed ? [] : ["  npm install"]),
    "  npm run dev",
    "",
    "Then open http://localhost:4321/admin to start editing. README.md explains how to put the site online.",
  ];
  if (!backend) {
    lines.push("Before you do, say where the site is stored in goodfellow.config.tsx; README.md shows how.");
  }
  stdout.write(`${lines.join("\n")}\n`);
}

/** Asks for the content repository, offering the code's with `-content` after it. */
async function askContentRepo(backend: Backend): Promise<string> {
  const suggested = `${backend.repo}-content`;
  for (;;) {
    const answer = (
      await ask(
        `\nThe ${HOST_NAMES[backend.host]} ${backend.host === "github" ? "repository" : "project"} for the content (${suggested}): `,
      )
    ).trim();
    if (answer === "") return suggested;
    const repo = parseRepo(backend.host, answer);
    if (repo && repo !== backend.repo) return repo;
    stdout.write(
      repo
        ? "The content needs a repository of its own, not the code's.\n"
        : `That doesn't look like a ${HOST_NAMES[backend.host]} address. Type it as ${suggested}.\n`,
    );
  }
}

/** The content repository as the options or answers gave it, checked against the rest. */
function separateContent(
  repo: string,
  build: string | undefined,
  backend: Backend | undefined,
  host: string | undefined,
): SeparateContent {
  if (!backend || !host) {
    throw new ScaffoldError(
      "Keeping the content in a repository of its own needs the code's repository (--github or --gitlab) and a host (--host).",
    );
  }
  const parsed = parseRepo(backend.host, repo);
  if (!parsed || parsed === backend.repo) {
    throw new ScaffoldError(
      "--content takes a repository of its own for the content, such as your-name/your-site-content.",
    );
  }
  const builds = contentBuildsFor(host as Host);
  const chosen = (build ?? builds.at(-1)) as ContentBuild;
  if (!builds.includes(chosen)) {
    throw new ScaffoldError(`${HOSTS[host as Host].label} can only build the site from the content repository.`);
  }
  return { repo: parsed, build: chosen };
}

/** Where the content went, and what's left to do with it. */
function contentLines(
  content: SeparateContent,
  git: GitResult | undefined,
  commit: CommitResult | undefined,
): string[] {
  const lines = [
    `Its content is in ${CONTENT_REPOSITORY_DIR}/, which content/ and public/media/ link to: a repository of its own for ${content.repo}, which the site's repository ignores.`,
  ];
  if (git?.created && commit === "committed")
    lines.push(`${CONTENT_REPOSITORY_DIR}/ has its content in its first commit.`);
  else if (git?.created) lines.push(`Commit everything in ${CONTENT_REPOSITORY_DIR}/ as well.`);
  lines.push("Push both repositories. README.md says what each needs to build the site.");
  return lines;
}

/** What happened with git, and what's left to do. */
function gitLines(git: GitResult, commit: CommitResult | undefined, installed: boolean): string[] {
  if (!git.created) {
    return [
      git.reason === "inside-repository"
        ? "It's inside another git repository, so it isn't one of its own."
        : "Git isn't installed, so it isn't a git repository yet: once it is, run git init -b main in it, then commit.",
    ];
  }
  const repository = "It's a git repository on the branch main";
  const origin = git.remote ? [`Its origin is ${git.remote}.`] : [];
  if (commit === "committed") {
    return [
      `${repository}, with everything in its first commit.`,
      ...origin,
      ...(installed ? [] : ["Commit package-lock.json after npm install: the deploy setups need it."]),
    ];
  }
  if (commit === "no-identity") {
    return [
      `${repository}, but git doesn't know your name and email yet, so nothing is committed. Tell it, then commit:`,
      '  git config --global user.name "Your Name"',
      "  git config --global user.email you@example.com",
      '  git add -A && git commit -m "Create the site"',
      ...origin,
    ];
  }
  return [`${repository}. Nothing is committed yet: commit everything once npm install has run.`, ...origin];
}

const BROKER_HOSTS: Record<BrokerHost, string> = {
  "github-pages": "GitHub Pages, at a domain of yours",
  "gitlab-pages": "GitLab Pages, at an address GitLab gives it",
  "cloudflare-pages": "Cloudflare Pages",
  vercel: "Vercel",
};

/** Where editors will sign in: the admin panel itself, an admin address, or a token broker. */
async function chooseSignIn(backend: Backend, host: Host | undefined): Promise<"site" | "admin" | "broker"> {
  const admin = allowsAdminAddress(host);
  return choose<"site" | "admin" | "broker">("Where will editors sign in?", [
    {
      value: "site",
      label: "In the admin panel, at the site's address",
      note: "The simplest. Their sign-in is kept where the site's own pages could reach it.",
    },
    ...(admin
      ? [
          {
            value: "admin" as const,
            label: "At an admin address of its own",
            note: "Such as admin.example.org, on a domain you have. The usual choice where you have one.",
          },
        ]
      : []),
    {
      value: "broker",
      label: "At a sign-in page of its own (a token broker)",
      note: `A second repository, put online at an address of its own${backend.host === "gitlab" ? ", which GitLab Pages gives it" : ""}. Keeps sign-ins where nothing on the site can reach them.`,
    },
  ]);
}

async function askAddress(question: string): Promise<string> {
  for (;;) {
    const answer = (await ask(`\n${question}`)).trim().replace(/\/+$/, "");
    if (/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(answer)) return answer;
    stdout.write("Type it as https:// and the domain, with nothing after it.\n");
  }
}

async function askDomain(): Promise<string> {
  for (;;) {
    const answer = (await ask("\nThe sign-in page's own domain, such as signin.example.org: ")).trim().toLowerCase();
    if (/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(answer) && !/(^|\.)(github|gitlab)\.io$/.test(answer)) return answer;
    stdout.write(
      "Type a domain of yours, such as signin.example.org. github.io addresses are shared with other sites.\n",
    );
  }
}

async function chooseHost(storage: Backend["host"] | undefined): Promise<Host | undefined> {
  stdout.write(
    "\nEach host's free plan has its own rules about business use. Check them if the site is for a business,",
  );
  stdout.write("\nsells anything, shows ads, or anyone is paid to build or look after it.\n");
  return choose<Host | undefined>("Where will the site be hosted?", [
    ...hostsFor(storage).map((value) => ({ value, label: HOSTS[value].label, note: HOSTS[value].note })),
    { value: undefined, label: "Not decided yet", note: "Keeps the setup files for every host." },
  ]);
}

main().catch((error: unknown) => {
  if ((error as { code?: string }).code === "ABORT_ERR") process.exit(130);
  console.error(error instanceof ScaffoldError ? error.message : error);
  process.exit(1);
});
