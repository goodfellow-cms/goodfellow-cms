"use client";

import {
  BLOCK_CHOICES,
  CLOUDFLARE_DEPLOY_HOOK,
  CONTENT_BUILDS,
  CONTENT_REPOSITORY_DIR,
  type CreatedSiteRepository,
  cloudflareContentBuild,
  contentBuildsFor,
  type FileChange,
  GOODFELLOW_REGISTRY,
  HOSTS,
  NETLIFY_BUILD_HOOK,
  newSiteSource,
  planBroker,
  planSite,
  type SetupAccount,
  SetupError,
  type SetupHost,
  type SetupOwner,
  type SetupStep,
  SignInError,
  type SiteFiles,
  separateSetupLinks,
  sitePackageName,
  TEMPLATES,
  withBase,
} from "@goodfellow-cms/core";
import { githubSetup } from "@goodfellow-cms/github";
import { gitlabSetup } from "@goodfellow-cms/gitlab";
import { SiteLink, useSite } from "@goodfellow-cms/react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  BROKER_HOSTS,
  brokerName,
  CHOOSE_PATH,
  type Choices,
  CONTENT_PLACES,
  choicesQuery,
  contentName,
  GIT_HOSTS,
  type GitHostName,
  gitNote,
  hostProblem,
  PURPOSES,
  parseChoices,
  SIGN_IN_PLACES,
  VISIBILITIES,
} from "./site-setup-choices";
import { button, fetchJson, input, LockfileWarning, link, Note, Question, type Starter } from "./site-setup-ui";

const STEP_LABELS: Record<SetupStep, string> = {
  repository: "Creating the repository",
  pages: "Turning on GitHub Pages",
  files: "Adding the site's files",
  protection: "Protecting the site's history",
  connect: "Letting each repository's builds read the other",
};

/**
 * The choices, kept in the browser tab while someone signs in and comes back:
 * GitLab only comes back to the address its application names, without the query.
 */
const CHOICES_KEY = "goodfellow:setup:choices";

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** The new site's files, worked out as `npm create goodfellow` would. */
async function siteFiles(
  base: string | undefined,
  choices: Choices,
  repo: string,
  name: string,
  content?: string,
): Promise<SiteFiles> {
  const starter = (await fetchJson(withBase(`/starters/${choices.template}.json`, base))) as Starter;
  const template: SiteFiles = new Map(
    Object.entries(starter.files).map(([path, file]) => [
      path,
      typeof file === "string" ? file : decodeBase64(file.base64),
    ]),
  );
  const registryUrl = new URL(withBase("/starters/registry/{name}.json", base), window.location.href).href;
  const files = await planSite({
    template,
    name: sitePackageName(name),
    versions: starter.versions,
    backend: { host: choices.git, repo },
    host: choices.host,
    ...(content && { content: { repo: content, build: choices.build } }),
    ...(choices.signIn === "admin-address" && { admin: choices.admin }),
    registry:
      choices.blocks === "recommended"
        ? { registries: { [GOODFELLOW_REGISTRY]: registryUrl.replace("%7Bname%7D", "{name}") }, fetchJson }
        : undefined,
  });
  if (starter.lockfile) {
    const lockfile = JSON.parse(starter.lockfile) as { name?: string; packages?: Record<string, { name?: string }> };
    lockfile.name = sitePackageName(name);
    const root = lockfile.packages?.[""];
    if (root) root.name = sitePackageName(name);
    files.set("package-lock.json", `${JSON.stringify(lockfile, null, 2)}\n`);
  }
  return files;
}

/** The token broker's repository's files: Goodfellow's released page, packed with the starters, and broker.json naming the site. */
async function brokerFiles(
  base: string | undefined,
  choices: Choices,
  site: { repo: string; code?: string },
  name: string,
): Promise<FileChange[]> {
  const packed = (await fetchJson(withBase("/starters/broker.json", base))) as Starter;
  const release = new Map(
    Object.entries(packed.files).map(([path, file]) => [
      path,
      typeof file === "string" ? new TextEncoder().encode(file) : decodeBase64(file.base64),
    ]),
  );
  return planBroker({
    release,
    site: newSiteSource({ host: choices.git, repo: site.repo }, site.code ? { code: site.code } : undefined),
    host: choices.brokerHost,
    ...(choices.brokerHost === "github-pages" && { domain: choices.brokerDomain }),
    name,
  });
}

/** One repository's files as the changes that write them: the content's are in its folder in the code's, `content-repository/`. */
function fileChanges(files: SiteFiles, which: "code" | "content"): FileChange[] {
  const prefix = `${CONTENT_REPOSITORY_DIR}/`;
  return [...files].flatMap(([path, file]): FileChange[] => {
    if (path.startsWith(prefix) !== (which === "content")) return [];
    const at = which === "content" ? path.slice(prefix.length) : path;
    return [typeof file === "string" ? { path: at, content: file } : { path: at, bytes: file }];
  });
}

function setupHost(git: GitHostName, gitlabClientId: string): SetupHost {
  return git === "github" ? githubSetup() : gitlabSetup({ clientId: gitlabClientId || undefined });
}

function signInMessage(error: unknown): string {
  if (error instanceof SignInError) {
    if (error.problem === "redirect-failed") return "Signing in didn't finish. Try again.";
    if (error.problem === "unavailable" || error.problem === "wrong-address" || error.problem === "local-address") {
      return "Signing in with GitHub isn't available here right now, perhaps because it's been used as much as it can be today. Paste a token instead.";
    }
    return "That token didn't work. Check it was copied completely and hasn't expired.";
  }
  return `Couldn't sign in: ${error instanceof Error ? error.message : String(error)}`;
}

function createMessage(error: unknown): string {
  if (error instanceof SetupError) {
    if (error.problem === "name-taken") return "There's already a repository with that name. Choose another name.";
    if (error.problem === "name-invalid") {
      return "That name can't be used. Use letters, numbers, dashes, dots and underscores only.";
    }
    if (error.problem === "not-installed") {
      return "Goodfellow isn't installed on that account yet. Install it there, then create the site.";
    }
    return "This sign-in isn't allowed to do that. Check the token's permissions (on GitHub, including Workflows and Administration), or choose your own account.";
  }
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`;
}

export interface SiteCreateFormProps {
  /** The Application ID of the GitLab OAuth application for this page, for "Sign in with GitLab". */
  gitlabClientId: string;
}

/** Problems a token gets around, where signing in by redirect isn't available. */
const TOKEN_PROBLEMS = new Set(["unavailable", "wrong-address", "local-address"]);

/**
 * The setup page's second step: the choices from the first, which its address
 * holds, then signing in to GitHub or GitLab, the account and name, and
 * creating the site in someone's own account, from their browser.
 */
export function SiteCreateForm({ gitlabClientId }: SiteCreateFormProps) {
  // Read from the address once the page is in the browser: `null` when it has no usable choices.
  const [choices, setChoices] = useState<Choices | null>();
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState<{ account?: SetupAccount; error?: unknown }>({});

  useEffect(() => {
    // Coming back from signing in: the choices made before, which GitLab's return address doesn't carry.
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(CHOICES_KEY);
      sessionStorage.removeItem(CHOICES_KEY);
    } catch {
      saved = null;
    }
    const found = parseChoices(saved ?? window.location.search) ?? null;
    setChoices(found);
    if (!saved || !found) return;
    setRestoring(true);
    setupHost(found.git, gitlabClientId)
      .restore()
      .then((account) => setRestored({ account: account ?? undefined }))
      .catch((error: unknown) => setRestored({ error }))
      .finally(() => {
        // Signing in has taken its own details out of the address: the choices go back in.
        window.history.replaceState(window.history.state, "", `${window.location.pathname}?${choicesQuery(found)}`);
        setRestoring(false);
      });
  }, [gitlabClientId]);

  if (choices === undefined || restoring) return <p aria-live="polite">Loading…</p>;
  if (choices === null) {
    return (
      <Note tone="warning">
        This page doesn't say what kind of site to create.{" "}
        <SiteLink className={link} href={CHOOSE_PATH}>
          Choose the site's options
        </SiteLink>{" "}
        first.
      </Note>
    );
  }
  return (
    <CreateSite
      choices={choices}
      gitlabClientId={gitlabClientId}
      restoredAccount={restored.account}
      restoreError={restored.error}
    />
  );
}

/** What the first step chose, with a way back to change it. */
function Summary({ choices }: { choices: Choices }) {
  const problem = hostProblem(choices);
  const note = gitNote(choices);
  const separate = choices.content === "separate";
  const rows: Array<[string, string]> = [
    ["For", PURPOSES[choices.purpose].label],
    ["Starting from", TEMPLATES[choices.template].label],
    ["Blocks", BLOCK_CHOICES[choices.blocks].label],
    ["Files kept on", `${GIT_HOSTS[choices.git].label}, ${VISIBILITIES[choices.visibility].label.toLowerCase()}`],
    ["Put online with", HOSTS[choices.host].label],
    [
      "Content kept",
      separate && contentBuildsFor(choices.host).length > 1
        ? `${CONTENT_PLACES[choices.content].label}, built from ${CONTENT_BUILDS[choices.build].label.toLowerCase()}`
        : CONTENT_PLACES[choices.content].label,
    ],
    [
      "Editors sign in",
      choices.signIn === "admin-address"
        ? `At ${choices.admin}`
        : choices.signIn === "broker"
          ? `At a sign-in page of its own, on ${BROKER_HOSTS[choices.brokerHost].label}`
          : SIGN_IN_PLACES["admin-panel"].label,
    ],
  ];
  return (
    <section aria-label="Your choices" className="grid gap-3 rounded-lg border border-border p-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <SiteLink
        className={`${link} justify-self-start text-sm font-medium`}
        href={`${CHOOSE_PATH}?${choicesQuery(choices)}`}
      >
        Change
      </SiteLink>
      {note && <Note>{note}</Note>}
      {problem && <Note tone="warning">{problem}</Note>}
    </section>
  );
}

function CreateSite({
  choices,
  gitlabClientId,
  restoredAccount,
  restoreError,
}: {
  choices: Choices;
  gitlabClientId: string;
  restoredAccount?: SetupAccount;
  restoreError?: unknown;
}) {
  const { base } = useSite();
  const id = useId();
  const [account, setAccount] = useState<SetupAccount | undefined>(restoredAccount);
  /** Whether the account was signed in with a token someone made for this page, which they can delete afterwards. */
  const [withToken, setWithToken] = useState(false);
  const [owners, setOwners] = useState<SetupOwner[]>([]);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("my-site");
  const [available, setAvailable] = useState<boolean>();
  const [contentAvailable, setContentAvailable] = useState<boolean>();
  /** Which of the two repositories is being created, while both are. */
  const [creating, setCreating] = useState<"code" | "content">();
  const [createdCode, setCreatedCode] = useState<CreatedSiteRepository>();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(
    restoreError === undefined ? undefined : signInMessage(restoreError),
  );
  const [step, setStep] = useState<SetupStep>();
  const [created, setCreated] = useState<CreatedSiteRepository>();
  /** The token broker's repository, made after the site's, or why it couldn't be. */
  const [broker, setBroker] = useState<{ created?: CreatedSiteRepository; error?: string }>();

  const host = useMemo(() => setupHost(choices.git, gitlabClientId), [choices.git, gitlabClientId]);
  // The token form is for when signing in by redirect isn't available, or didn't work for a reason a token gets around.
  const [showToken, setShowToken] = useState(
    !host.canRedirect || (restoreError instanceof SignInError && TOKEN_PROBLEMS.has(restoreError.problem)),
  );
  const failedSignIn = (caught: unknown) => {
    setError(signInMessage(caught));
    if (caught instanceof SignInError && TOKEN_PROBLEMS.has(caught.problem)) setShowToken(true);
  };

  useEffect(() => {
    if (!account) return;
    account
      .owners()
      .then((found) => {
        setOwners(found);
        setOwner(found[0]?.path ?? "");
      })
      .catch((caught: unknown) => setError(createMessage(caught)));
  }, [account]);

  const chosenOwner = owners.find((candidate) => candidate.path === owner);
  // The code's repository, where creating the content's failed after it: trying again carries on from it.
  const codeCreated = createdCode !== undefined && createdCode.repo === `${chosenOwner?.path}/${name}`;
  const validName = /^[A-Za-z0-9._-]+$/.test(name) && !/^[.-]/.test(name);
  const separate = choices.content === "separate";
  useEffect(() => {
    setAvailable(undefined);
    setContentAvailable(undefined);
    if (!account || !chosenOwner || !validName) return;
    const timer = setTimeout(() => {
      account.isAvailable(chosenOwner, name).then(setAvailable, () => setAvailable(undefined));
      if (separate) {
        account
          .isAvailable(chosenOwner, contentName(name))
          .then(setContentAvailable, () => setContentAvailable(undefined));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [account, chosenOwner, name, validName, separate]);

  async function signIn() {
    setBusy(true);
    setError(undefined);
    try {
      setAccount(await host.signInWithToken(token));
      setWithToken(true);
      setToken("");
    } catch (caught) {
      failedSignIn(caught);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithRedirect(install = false) {
    setError(undefined);
    sessionStorage.setItem(CHOICES_KEY, choicesQuery(choices));
    try {
      await host.startRedirect({ install });
    } catch (caught) {
      sessionStorage.removeItem(CHOICES_KEY);
      failedSignIn(caught);
    }
  }

  async function create() {
    if (!account || !chosenOwner) return;
    setBusy(true);
    setError(undefined);
    try {
      const repo = `${chosenOwner.path}/${name}`;
      const content = separate ? `${chosenOwner.path}/${contentName(name)}` : undefined;
      const files = await siteFiles(base, choices, repo, name, content);
      const site = {
        owner: chosenOwner,
        private: choices.visibility === "private",
        description: "A website made with Goodfellow",
        message: "Create the site",
      };
      // GitHub Pages and GitLab Pages publish the repository that builds the site: the content's, where it has one.
      const pages = choices.host === "github-pages" || choices.host === "gitlab-pages";
      const withBroker = choices.signIn === "broker";
      // The sign-in page's repository, after the site's: a failure there leaves the site made, saying what's left.
      const addBroker = async (signsIn: { repo: string; code?: string }) => {
        if (!withBroker) return;
        try {
          const brokerHost = choices.brokerHost;
          const brokerCreated = await account.createSite(
            {
              owner: chosenOwner,
              name: brokerName(name),
              private: false,
              description: "The sign-in page of a website made with Goodfellow",
              pages: brokerHost === "github-pages" || brokerHost === "gitlab-pages",
              ...(brokerHost === "github-pages" && { domain: choices.brokerDomain }),
              files: await brokerFiles(base, choices, signsIn, name),
              message: "Add the sign-in page",
            },
            setStep,
          );
          setBroker({ created: brokerCreated });
        } catch (caught) {
          setBroker({ error: createMessage(caught) });
        }
      };
      if (!content) {
        const result = await account.createSite(
          { ...site, name, pages, files: fileChanges(files, "code"), ...(withBroker && { more: true }) },
          setStep,
        );
        await addBroker({ repo });
        setCreated(result);
        return;
      }
      setCreating("code");
      // A site that failed halfway, with its code created, carries on with the content.
      const code =
        createdCode?.repo === repo
          ? createdCode
          : await account.createSite(
              { ...site, name, pages: false, files: fileChanges(files, "code"), more: true },
              setStep,
            );
      setCreatedCode(code);
      setCreating("content");
      const result = await account.createSite(
        {
          ...site,
          name: contentName(name),
          description: "The content of a website made with Goodfellow",
          pages,
          files: fileChanges(files, "content"),
          ...(withBroker && { more: true }),
          link: {
            code: code.repo,
            content,
            private: site.private,
            links: separateSetupLinks({ git: choices.git, host: choices.host, build: choices.build }),
          },
        },
        setStep,
      );
      await addBroker({ repo: content, code: code.repo });
      setCreated(result);
    } catch (caught) {
      setError(createMessage(caught));
    } finally {
      setBusy(false);
      setStep(undefined);
      setCreating(undefined);
    }
  }

  if (created) {
    return <Created created={created} code={createdCode} broker={broker} choices={choices} withToken={withToken} />;
  }

  const gitName = GIT_HOSTS[choices.git].label;

  return (
    <div className="grid gap-8">
      <LockfileWarning />
      <Summary choices={choices} />

      <Question title={`Sign in to ${gitName}`}>
        {account ? (
          <p>
            Signed in as <strong>{account.user.name ?? account.user.login}</strong> ({account.user.login}).{" "}
            <button
              type="button"
              className={link}
              onClick={() => {
                setAccount(undefined);
                setWithToken(false);
              }}
            >
              Use another account
            </button>
          </p>
        ) : (
          <>
            {host.canRedirect && (
              <div className="grid justify-items-start gap-2">
                <button type="button" className={button} disabled={busy} onClick={() => void signInWithRedirect()}>
                  Sign in with {gitName}
                </button>
                {!showToken && (
                  <p className="text-sm">
                    Or{" "}
                    <button type="button" className={link} onClick={() => setShowToken(true)}>
                      paste a token
                    </button>
                  </p>
                )}
              </div>
            )}
            {showToken && (
              <TokenForm
                id={id}
                host={host}
                gitName={gitName}
                github={choices.git === "github"}
                redirect={host.canRedirect}
                token={token}
                setToken={setToken}
                busy={busy}
                onSubmit={() => void signIn()}
              />
            )}
          </>
        )}
      </Question>

      {account && (
        <Question title="Name">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-owner`}>
              Account or group
            </label>
            <select
              id={`${id}-owner`}
              className={`${input} w-auto`}
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            >
              {owners.map((candidate) => (
                <option key={candidate.path} value={candidate.path}>
                  {candidate.path}
                </option>
              ))}
            </select>
            <span aria-hidden="true">/</span>
            <label className="sr-only" htmlFor={`${id}-name`}>
              Name
            </label>
            <input
              id={`${id}-name`}
              className={`${input} max-w-xs`}
              value={name}
              onChange={(event) => setName(event.target.value.trim())}
            />
          </div>
          {chosenOwner?.installUrl && (
            <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
              <p>
                Before creating a site in {chosenOwner.path}, install Goodfellow there. GitHub asks where: choose{" "}
                {chosenOwner.path}, then come back here, signed in. It lets this page create the site's repository and
                set it up.
              </p>
              <button
                type="button"
                className={`${button} justify-self-start`}
                disabled={busy}
                onClick={() => void signInWithRedirect(true)}
              >
                Install Goodfellow on GitHub
              </button>
            </div>
          )}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {!validName
              ? "Use letters, numbers, dashes, dots and underscores only."
              : (available === false && !codeCreated) || (separate && contentAvailable === false)
                ? separate
                  ? `There's already one called ${available === false && !codeCreated ? name : contentName(name)}.`
                  : "There's already one with that name."
                : (available || codeCreated) && (!separate || contentAvailable)
                  ? "That name is free."
                  : "It becomes part of the site's address."}
          </p>
          {separate && validName && (
            <p className="text-sm">
              The code goes in {chosenOwner?.path ?? ""}/{name}, and the content in {chosenOwner?.path ?? ""}/
              {contentName(name)}
              {choices.host === "vercel" || choices.host === "cloudflare-pages"
                ? "."
                : ", which publishes the site, so its address follows that name."}
            </p>
          )}
        </Question>
      )}

      {error && <Note tone="warning">{error}</Note>}

      {account && (
        <div className="grid gap-3">
          <button
            type="button"
            className={`${button} justify-self-start`}
            disabled={
              busy ||
              !chosenOwner ||
              Boolean(chosenOwner.installUrl) ||
              !validName ||
              (available === false && !codeCreated) ||
              (separate && contentAvailable === false)
            }
            onClick={() => void create()}
          >
            Create the site
          </button>
          {step && (
            <p aria-live="polite" className="text-sm">
              {creating === "code"
                ? "The code's repository: "
                : creating === "content"
                  ? "The content's repository: "
                  : ""}
              {STEP_LABELS[step]}…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TokenForm({
  id,
  host,
  gitName,
  github,
  redirect,
  token,
  setToken,
  busy,
  onSubmit,
}: {
  id: string;
  host: SetupHost;
  gitName: string;
  github: boolean;
  redirect: boolean;
  token: string;
  setToken: (token: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm">
        {redirect ? "Paste a token instead. " : "Paste a token to sign in. "}
        {github
          ? "On GitHub's page, choose All repositories under Repository access, since the new repository doesn't exist yet. The permissions it needs are filled in."
          : "On GitLab's page, the name and the api scope are filled in."}{" "}
        The token is only used on this page, to create the site. It isn't saved, and you can delete it once the site is
        created.
      </p>
      <ul className="grid gap-1 text-sm">
        {host.tokenLinks.map((tokenLink) => (
          <li key={tokenLink.url}>
            <SiteLink className={link} href={tokenLink.url} target="_blank" rel="noopener noreferrer">
              {tokenLink.label === "signIn.token.create"
                ? `Create a token on ${gitName}`
                : "Or create a classic token, if fine-grained ones aren't allowed for your account"}
            </SiteLink>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="sr-only" htmlFor={`${id}-token`}>
          Token
        </label>
        <input
          id={`${id}-token`}
          type="password"
          autoComplete="off"
          className={`${input} max-w-md flex-1`}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Paste the token here"
        />
        <button type="submit" className={button} disabled={busy || !token.trim()}>
          Sign in
        </button>
      </form>
    </div>
  );
}

function RepoLink({ repo }: { repo: CreatedSiteRepository }) {
  return (
    <SiteLink className={link} href={repo.webUrl} target="_blank" rel="noopener noreferrer">
      {repo.repo}
    </SiteLink>
  );
}

/**
 * Putting a site created for Cloudflare Pages online: importing the repository
 * Cloudflare builds, which is the content's where it has one, with its build
 * settings, then giving the setup files the project's deploy hook.
 */
function CloudflareSteps({
  created,
  code,
  choices,
}: {
  created: CreatedSiteRepository;
  code?: CreatedSiteRepository;
  choices: Choices;
}) {
  const github = choices.git === "github";
  const next = choices.template === "next";
  const build = code
    ? cloudflareContentBuild({
        git: choices.git,
        host: "cloudflare-pages",
        build: "content",
        code: code.repo,
        content: created.repo,
        next,
      })
    : { command: "npm run build", output: next ? "out" : "dist" };
  const hookIn = code ? `${code.repo} and ${created.repo}` : created.repo;
  return (
    <Note>
      Now put it online with Cloudflare Pages. In{" "}
      <SiteLink className={link} href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">
        Cloudflare's dashboard
      </SiteLink>
      , go to Workers &amp; Pages, create a Pages project with Import an existing Git repository, connect your{" "}
      {github ? "GitHub" : "GitLab"} account and choose {created.repo}. Choose no framework preset, the build command{" "}
      <code>{build.command}</code> and the build output directory <code>{build.output}</code>
      {code &&
        ", and if the code repository is private, add a token that can only read it as the GOODFELLOW_CODE_TOKEN variable"}
      . Then, under the project's Settings → Builds, add a deploy hook for the main branch, and add it to {hookIn} as
      the {CLOUDFLARE_DEPLOY_HOOK}{" "}
      {github
        ? "secret (Settings → Secrets and variables → Actions)"
        : "variable (Settings → CI/CD → Variables, masked)"}
      , for the nightly update and rebuild{github ? "" : ", which the admin panel's Updates screen turns on"}.
    </Note>
  );
}

/** How to put a new site online with Netlify: importing the repository, then giving the setup files its build hook. */
function NetlifySteps({ created, choices }: { created: CreatedSiteRepository; choices: Choices }) {
  const github = choices.git === "github";
  return (
    <Note>
      Now put it online with Netlify. In{" "}
      <SiteLink className={link} href="https://app.netlify.com/start" target="_blank" rel="noopener noreferrer">
        Netlify
      </SiteLink>
      , choose Import an existing project, connect your {github ? "GitHub" : "GitLab"} account and choose {created.repo}
      . Its settings are already in its netlify.toml. Then, under the site's Project configuration → Build &amp; deploy
      → Build hooks, add a build hook for the main branch, and add it to {created.repo} as the {NETLIFY_BUILD_HOOK}{" "}
      {github
        ? "secret (Settings → Secrets and variables → Actions)"
        : "variable (Settings → CI/CD → Variables, masked)"}
      , for the nightly update and rebuild{github ? "" : ", which the admin panel's Updates screen turns on"}.
    </Note>
  );
}

/**
 * The site that was created. For a site whose content has a repository of its
 * own, `created` is the content's, which editors sign in to and Pages
 * publishes, and `code` the code's.
 */
function Created({
  created,
  code,
  broker,
  choices,
  withToken,
}: {
  created: CreatedSiteRepository;
  code?: CreatedSiteRepository;
  broker?: { created?: CreatedSiteRepository; error?: string };
  choices: Choices;
  withToken: boolean;
}) {
  const github = choices.git === "github";
  const separate = code !== undefined;
  // The repository Vercel is connected to.
  const vercelRepo = separate && choices.build === "code" ? code : created;
  return (
    <div className="grid gap-4" aria-live="polite">
      <h2 className="font-heading text-2xl font-semibold">Your site has been created</h2>
      {code ? (
        <p>
          Its code is in <RepoLink repo={code} />, and its content in <RepoLink repo={created} />, which editors sign in
          to.
        </p>
      ) : (
        <p>
          Its files are in <RepoLink repo={created} />.
        </p>
      )}
      {choices.signIn === "admin-address" && (
        <Note>
          {choices.content === "separate" ? (
            <>
              Once the site is online, connect {choices.admin} on the admin panel's Site Settings → Domain, then run{" "}
              <code>npx goodfellow admin check</code> in the code's folder, which checks it before editors sign in
              there.
            </>
          ) : (
            <>
              Once the site is online, open its admin panel and connect {choices.admin} on Site Settings → Domain, which
              checks it before editors sign in there.
            </>
          )}
        </Note>
      )}
      {broker?.created && (
        <Note>
          Editors' sign-in page is in <RepoLink repo={broker.created} />.{" "}
          {choices.brokerHost === "github-pages"
            ? `GitHub Pages puts it online at ${choices.brokerDomain} once you point the domain at GitHub Pages, as the repository's Settings → Pages says.`
            : choices.brokerHost === "gitlab-pages"
              ? "GitLab Pages puts it online at an address of its own, shown under Deploy → Pages in its project once it's built."
              : `Put it online with ${BROKER_HOSTS[choices.brokerHost].label}, as its README says.`}{" "}
          Once it's online, and the site too, open the site's admin panel and set its address on Site Settings →
          Security. Editors sign in there from then on.
        </Note>
      )}
      {broker?.error && (
        <Note tone="warning">
          The site was made, but its sign-in page wasn't: {broker.error} Add one later on the site's Site Settings →
          Security.
        </Note>
      )}
      {created.warnings.includes("connect-unavailable") && (
        <Note tone="warning">
          The two repositories couldn't be set up to read each other, perhaps because this sign-in can't add deploy keys
          or secrets. Follow the steps for private repositories in{" "}
          <SiteLink className={link} href="/docs/content-repository">
            Content in a repository of its own
          </SiteLink>
          , and each setup file's notes.
        </Note>
      )}
      {created.signInInstallUrl && (
        <Note>
          The first time you open the site's admin panel, Sign in with GitHub offers to install Goodfellow's sign-in on
          {` ${created.repo}`}, which signs you in too. After that, editors sign in with GitHub as well.
        </Note>
      )}
      {created.warnings.includes("pages-unavailable") && (
        <Note tone="warning">
          GitHub Pages couldn't be turned on, most likely because the repository is private and the account is on
          GitHub's free plan. Make the repository public in its Settings, then under Settings → Pages set Source to
          GitHub Actions, and run Deploy to GitHub Pages again under Actions.
        </Note>
      )}
      {choices.host === "cloudflare-pages" ? (
        <CloudflareSteps created={created} code={code} choices={choices} />
      ) : choices.host === "netlify" ? (
        <NetlifySteps created={created} choices={choices} />
      ) : choices.host === "vercel" ? (
        <Note>
          Now put it online with Vercel: open{" "}
          <SiteLink className={link} href="https://vercel.com/new" target="_blank" rel="noopener noreferrer">
            vercel.com/new
          </SiteLink>
          , connect your {github ? "GitHub" : "GitLab"} account if you haven't already, and import {vercelRepo.repo}.
          Its settings are already in its vercel.ts.
          {separate &&
            " Then add the Vercel project's deploy hook to the other repository, and a token if they're private, as Content in a repository of its own explains."}
        </Note>
      ) : created.siteUrl ? (
        <p>
          It's being built, which takes a few minutes the first time (
          <SiteLink className={link} href={created.buildsUrl} target="_blank" rel="noopener noreferrer">
            follow the build
          </SiteLink>
          ). Then it's at{" "}
          <SiteLink className={link} href={created.siteUrl} target="_blank" rel="noopener noreferrer">
            {created.siteUrl}
          </SiteLink>
          , and its admin panel at{" "}
          <SiteLink
            className={link}
            href={`${created.siteUrl.replace(/\/?$/, "/")}admin/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {created.siteUrl.replace(/\/?$/, "/")}admin/
          </SiteLink>
          .
        </p>
      ) : (
        <p>
          It's being built, which takes a few minutes the first time (
          <SiteLink className={link} href={created.buildsUrl} target="_blank" rel="noopener noreferrer">
            follow the build
          </SiteLink>
          ). Its address is then shown under{" "}
          {created.pagesUrl ? (
            <SiteLink className={link} href={created.pagesUrl} target="_blank" rel="noopener noreferrer">
              Deploy → Pages
            </SiteLink>
          ) : (
            "Deploy → Pages"
          )}
          , and the admin panel is at that address followed by /admin/.
        </p>
      )}
      {!github && (
        <Note>
          New GitLab accounts may need to verify their identity before GitLab runs builds. If the first build waits or
          fails with a message about it, follow GitLab's steps, then run it again.
        </Note>
      )}
      <h3 className="font-heading text-lg font-semibold">Next</h3>
      <ul className="grid list-disc gap-1 pl-5">
        {code && github && choices.host === "github-pages" && (
          <li>
            Changes to the code go live with the content repository's nightly build. To have them go live straight away,
            add a GOODFELLOW_BUILD_TOKEN secret to {code.repo}, as its update workflow explains.
          </li>
        )}
        {code && github && (
          <li>
            {withToken
              ? `Give the tokens editors sign in with access to ${code.repo} too, with Contents and Actions read, so the admin panel's Updates screen can follow the updates that run there.`
              : `Install Goodfellow's sign-in on ${code.repo} too, so the admin panel's Updates screen can follow the updates that run there.`}
          </li>
        )}
        {code && (
          <li>
            Developers work on the site as its code's README explains, with the content cloned into its{" "}
            {CONTENT_REPOSITORY_DIR}/ folder.
          </li>
        )}
        {withToken && github && (
          <li>
            Delete the token you made for this page, on GitHub's{" "}
            <SiteLink
              className={link}
              href="https://github.com/settings/personal-access-tokens"
              target="_blank"
              rel="noopener noreferrer"
            >
              fine-grained tokens
            </SiteLink>{" "}
            or{" "}
            <SiteLink
              className={link}
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
            >
              classic tokens
            </SiteLink>{" "}
            page. Editors sign in to the admin panel with tokens of their own.
          </li>
        )}
        <li>
          Read{" "}
          <SiteLink className={link} href="/docs/sign-in">
            Editors and sign-in
          </SiteLink>{" "}
          to sign in to the admin panel and invite other editors.
        </li>
        <li>
          Set the site's address under Site settings once it's online, and see{" "}
          <SiteLink className={link} href="/docs/put-it-online">
            Put it online
          </SiteLink>{" "}
          for the rest.
        </li>
      </ul>
    </div>
  );
}
