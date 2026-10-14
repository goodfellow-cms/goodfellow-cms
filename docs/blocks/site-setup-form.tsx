"use client";

import {
  BLOCK_CHOICES,
  type BlockChoice,
  type CreatedSiteRepository,
  GOODFELLOW_REGISTRY,
  HOSTS,
  type Host,
  hostsFor,
  planSite,
  type SetupAccount,
  SetupError,
  type SetupHost,
  type SetupOwner,
  type SetupStep,
  SignInError,
  type SiteFiles,
  sitePackageName,
  TEMPLATES,
  type TemplateName,
  withBase,
} from "@goodfellow-cms/core";
import { githubSetup } from "@goodfellow-cms/github";
import { gitlabSetup } from "@goodfellow-cms/gitlab";
import { SiteLink, useSite } from "@goodfellow-cms/react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

type Purpose = "personal" | "group" | "business";
type GitHostName = "github" | "gitlab";

interface Choices {
  purpose: Purpose;
  template: TemplateName;
  blocks: BlockChoice;
  git: GitHostName;
  host: Host;
  private: boolean;
}

const DEFAULT_CHOICES: Choices = {
  purpose: "group",
  template: "starter",
  blocks: "recommended",
  git: "github",
  host: "github-pages",
  private: false,
};

const PURPOSES: Record<Purpose, { label: string; description: string }> = {
  personal: { label: "Personal, or a hobby", description: "A site of your own, with nobody paid to make it." },
  group: { label: "A church, charity, school or club", description: "A nonprofit group, run by volunteers." },
  business: {
    label: "A business",
    description: "Or any site that sells things, advertises products or services for sale, or shows ads.",
  },
};

const GIT_HOSTS: Record<GitHostName, { label: string; description: string }> = {
  github: { label: "GitHub", description: "Free. GitHub Pages needs a public repository on GitHub's free plan." },
  gitlab: {
    label: "GitLab",
    description: "Free, for public and private projects. A private group can have up to 5 people on the free plan.",
  },
};

const STEP_LABELS: Record<SetupStep, string> = {
  repository: "Creating the repository",
  pages: "Turning on GitHub Pages",
  files: "Adding the site's files",
  protection: "Protecting the site's history",
};

/** Kept in the browser tab while someone signs in with GitLab and comes back. */
const CHOICES_KEY = "goodfellow:setup:choices";

/**
 * Where to keep a site's files: GitLab for business sites and private ones,
 * whose free hosting allows both. Either is fine otherwise.
 */
function recommendedGit(choices: Choices): GitHostName | undefined {
  return choices.purpose === "business" || choices.private ? "gitlab" : undefined;
}

/**
 * The host whose free plan allows a site like this, for the git host chosen.
 * None for a private repository on GitHub, which GitHub Pages' free plan doesn't serve:
 * GitLab is recommended instead.
 */
function recommendedHost(choices: Choices): Host | undefined {
  if (choices.git === "gitlab" || choices.purpose === "business") return "gitlab-pages";
  return choices.private ? undefined : "github-pages";
}

/** Why a host's free plan may not allow this site, or `undefined` if it does. */
function hostProblem(purpose: Purpose, choices: Choices): string | undefined {
  if (purpose === "business" && choices.host === "github-pages") {
    return "GitHub Pages isn't for running a business or a shop. GitLab Pages is the free host for business sites.";
  }
  if (purpose === "business" && choices.host === "vercel") {
    return "Vercel's free plan is for non-commercial sites only. GitLab Pages is the free host for business sites.";
  }
  if (choices.host === "vercel" && purpose === "group") {
    return "Vercel's free plan counts a site as commercial if anyone is paid to make or update it. A site kept by volunteers is fine.";
  }
  return undefined;
}

interface Starter {
  versions: Record<string, string>;
  files: Record<string, string | { base64: string }>;
  lockfile?: string;
}

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status}).`);
  return response.json();
}

/** The new site's files, worked out as `npm create goodfellow` would. */
async function siteFiles(base: string | undefined, choices: Choices, repo: string, name: string): Promise<SiteFiles> {
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

function Choice<T extends string>({
  name,
  value,
  current,
  label,
  description,
  badge,
  onChange,
}: {
  name: string;
  value: T;
  current: T;
  label: string;
  description?: string;
  badge?: string;
  onChange: (value: T) => void;
}) {
  const id = `${name}-${value}`;
  return (
    <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-muted">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        className="mt-1 accent-primary"
      />
      <span>
        <span id={`${id}-label`} className="font-medium">
          {label}
        </span>
        {badge && (
          <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">{badge}</span>
        )}
        {description && (
          <span id={`${id}-description`} className="block text-sm text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 font-heading text-lg font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function Note({ tone = "info", children }: { tone?: "info" | "warning"; children: ReactNode }) {
  return (
    <p
      role={tone === "warning" ? "alert" : undefined}
      className={
        tone === "warning"
          ? "rounded-lg border-2 border-primary bg-muted p-3 text-sm font-medium"
          : "rounded-lg bg-muted p-3 text-sm"
      }
    >
      {children}
    </p>
  );
}

const button =
  "inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50";
const input = "w-full rounded-lg border border-border bg-background px-3 py-2";
const link = "underline underline-offset-2";

export interface SiteSetupFormProps {
  /** The Application ID of the GitLab OAuth application for this page, for "Sign in with GitLab". */
  gitlabClientId: string;
}

/** Creates a Goodfellow site in someone's GitHub or GitLab account, from their browser. */
export function SiteSetupForm({ gitlabClientId }: SiteSetupFormProps) {
  const { base } = useSite();
  const id = useId();
  const [choices, setChoices] = useState<Choices>(DEFAULT_CHOICES);
  const [account, setAccount] = useState<SetupAccount>();
  const [owners, setOwners] = useState<SetupOwner[]>([]);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("my-site");
  const [available, setAvailable] = useState<boolean>();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [step, setStep] = useState<SetupStep>();
  const [created, setCreated] = useState<CreatedSiteRepository>();
  const [hasLockfiles, setHasLockfiles] = useState(true);

  const host = useMemo(() => setupHost(choices.git, gitlabClientId), [choices.git, gitlabClientId]);
  const update = (change: Partial<Choices>) => {
    setChoices((current) => {
      const next = { ...current, ...change };
      // A new purpose or git host suggests its own host, which must be one that git host can use.
      const suggested = recommendedHost(next) ?? hostsFor(next.git)[0] ?? "github-pages";
      if (change.purpose || change.git || !hostsFor(next.git).includes(next.host)) next.host = suggested;
      return next;
    });
    if (change.git) setAccount(undefined);
  };

  // Coming back from signing in with GitLab: the choices made before, then the sign-in.
  useEffect(() => {
    let saved: Choices | undefined;
    try {
      const text = sessionStorage.getItem(CHOICES_KEY);
      sessionStorage.removeItem(CHOICES_KEY);
      saved = text ? { ...DEFAULT_CHOICES, ...(JSON.parse(text) as Partial<Choices>) } : undefined;
    } catch {
      saved = undefined;
    }
    if (!saved) return;
    setChoices(saved);
    setBusy(true);
    setupHost(saved.git, gitlabClientId)
      .restore()
      .then((restored) => restored && setAccount(restored))
      .catch((caught: unknown) => setError(signInMessage(caught)))
      .finally(() => setBusy(false));
  }, [gitlabClientId]);

  useEffect(() => {
    fetchJson(withBase("/starters/starter.json", base))
      .then((starter) => setHasLockfiles(Boolean((starter as Starter).lockfile)))
      .catch(() => setHasLockfiles(false));
  }, [base]);

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
  const validName = /^[A-Za-z0-9._-]+$/.test(name) && !/^[.-]/.test(name);
  useEffect(() => {
    setAvailable(undefined);
    if (!account || !chosenOwner || !validName) return;
    const timer = setTimeout(() => {
      account.isAvailable(chosenOwner, name).then(setAvailable, () => setAvailable(undefined));
    }, 400);
    return () => clearTimeout(timer);
  }, [account, chosenOwner, name, validName]);

  async function signIn() {
    setBusy(true);
    setError(undefined);
    try {
      setAccount(await host.signInWithToken(token));
      setToken("");
    } catch (caught) {
      setError(signInMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithRedirect(install = false) {
    setError(undefined);
    sessionStorage.setItem(CHOICES_KEY, JSON.stringify(choices));
    try {
      await host.startRedirect({ install });
    } catch (caught) {
      sessionStorage.removeItem(CHOICES_KEY);
      setError(signInMessage(caught));
    }
  }

  async function create() {
    if (!account || !chosenOwner) return;
    setBusy(true);
    setError(undefined);
    try {
      const repo = `${chosenOwner.path}/${name}`;
      const files = await siteFiles(base, choices, repo, name);
      const result = await account.createSite(
        {
          owner: chosenOwner,
          name,
          private: choices.private,
          description: "A website made with Goodfellow",
          pages: choices.host !== "vercel",
          files: [...files].map(([path, file]) =>
            typeof file === "string" ? { path, content: file } : { path, bytes: file },
          ),
          message: "Create the site",
        },
        setStep,
      );
      setCreated(result);
    } catch (caught) {
      setError(createMessage(caught));
    } finally {
      setBusy(false);
      setStep(undefined);
    }
  }

  if (created) return <Created created={created} choices={choices} />;

  const problem = hostProblem(choices.purpose, choices);
  const privatePages = choices.private && choices.host === "github-pages";
  const gitName = GIT_HOSTS[choices.git].label;

  return (
    <div className="grid gap-8">
      {!hasLockfiles && (
        <Note tone="warning">
          This copy of the documentation has no package-lock.json files, so sites it creates won't build until one is
          added. The published documentation includes them.
        </Note>
      )}

      <Question title="What's the site for?">
        {(Object.keys(PURPOSES) as Purpose[]).map((value) => (
          <Choice
            key={value}
            name={`${id}-purpose`}
            value={value}
            current={choices.purpose}
            {...PURPOSES[value]}
            onChange={(purpose) => update({ purpose })}
          />
        ))}
      </Question>

      <Question title="Start from">
        {(Object.keys(TEMPLATES) as TemplateName[]).map((value) => (
          <Choice
            key={value}
            name={`${id}-template`}
            value={value}
            current={choices.template}
            {...TEMPLATES[value]}
            onChange={(template) => update({ template })}
          />
        ))}
      </Question>

      <Question title="Blocks">
        {(Object.keys(BLOCK_CHOICES) as BlockChoice[]).map((value) => (
          <Choice
            key={value}
            name={`${id}-blocks`}
            value={value}
            current={choices.blocks}
            {...BLOCK_CHOICES[value]}
            onChange={(blocks) => update({ blocks })}
          />
        ))}
      </Question>

      <Question title="Who can see the site's files">
        <Choice
          name={`${id}-visibility`}
          value="public"
          current={choices.private ? "private" : "public"}
          label="Public"
          description="Anyone can see the site's files, as they can see the site. Editors and their changes are listed too."
          onChange={() => update({ private: false })}
        />
        <Choice
          name={`${id}-visibility`}
          value="private"
          current={choices.private ? "private" : "public"}
          label="Private"
          description="Only the people you invite can see the files. The site itself is public either way."
          onChange={() => update({ private: true })}
        />
      </Question>

      <Question title="Where to keep the site's files">
        {(Object.keys(GIT_HOSTS) as GitHostName[]).map((value) => (
          <Choice
            key={value}
            name={`${id}-git`}
            value={value}
            current={choices.git}
            {...GIT_HOSTS[value]}
            badge={value === recommendedGit(choices) ? "Recommended" : undefined}
            onChange={(git) => update({ git })}
          />
        ))}
        {choices.git === "github" && recommendedGit(choices) === "gitlab" && (
          <Note>
            {choices.purpose === "business"
              ? "GitHub's free hosting isn't for business sites, so business sites are best kept on GitLab, with GitLab Pages."
              : "Private sites are best kept on GitLab: GitLab Pages works with private projects on its free plan, and GitHub Pages doesn't work with private repositories on GitHub's."}{" "}
            <button type="button" className={link} onClick={() => update({ git: "gitlab" })}>
              Use GitLab
            </button>
          </Note>
        )}
      </Question>

      <Question title="Where to put it online">
        {hostsFor(choices.git).map((value) => (
          <Choice
            key={value}
            name={`${id}-host`}
            value={value}
            current={choices.host}
            label={HOSTS[value].label}
            description={HOSTS[value].note}
            badge={value === recommendedHost(choices) ? "Recommended" : undefined}
            onChange={(chosen) => update({ host: chosen })}
          />
        ))}
        {problem && <Note tone="warning">{problem}</Note>}
        {privatePages && (
          <Note tone="warning">
            GitHub Pages doesn't work with private repositories on GitHub's free plan, unless your account has GitHub
            Pro, Team or Enterprise. Keep the site on GitLab instead, or make the repository public.
          </Note>
        )}
        {choices.host === "vercel" && (
          <Note>
            Once the repository is created, you'll connect it to Vercel, which needs an account there, free for
            non-commercial sites.
          </Note>
        )}
      </Question>

      <Question title={`Sign in to ${gitName}`}>
        {account ? (
          <p>
            Signed in as <strong>{account.user.name ?? account.user.login}</strong> ({account.user.login}).{" "}
            <button type="button" className={link} onClick={() => setAccount(undefined)}>
              Use another account
            </button>
          </p>
        ) : (
          <>
            {host.canRedirect && (
              <button type="button" className={button} disabled={busy} onClick={() => void signInWithRedirect()}>
                Sign in with {gitName}
              </button>
            )}
            <p className="text-sm">
              {host.canRedirect ? "Or paste a token. " : "Paste a token to sign in. "}
              {choices.git === "github"
                ? "On GitHub's page, choose All repositories under Repository access, since the new repository doesn't exist yet. The permissions it needs are filled in."
                : "On GitLab's page, the name and the api scope are filled in."}{" "}
              The token is only used on this page, to create the site. It isn't saved, and you can delete it once the
              site is created.
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
                void signIn();
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
              : available === false
                ? "There's already one with that name."
                : available
                  ? "That name is free."
                  : "It becomes part of the site's address."}
          </p>
        </Question>
      )}

      {error && <Note tone="warning">{error}</Note>}

      {account && (
        <div className="grid gap-3">
          <button
            type="button"
            className={`${button} justify-self-start`}
            disabled={busy || !chosenOwner || Boolean(chosenOwner.installUrl) || !validName || available === false}
            onClick={() => void create()}
          >
            Create the site
          </button>
          {step && (
            <p aria-live="polite" className="text-sm">
              {STEP_LABELS[step]}…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Created({ created, choices }: { created: CreatedSiteRepository; choices: Choices }) {
  const github = choices.git === "github";
  return (
    <div className="grid gap-4" aria-live="polite">
      <h2 className="font-heading text-2xl font-semibold">Your site has been created</h2>
      <p>
        Its files are in{" "}
        <SiteLink className={link} href={created.webUrl} target="_blank" rel="noopener noreferrer">
          {created.repo}
        </SiteLink>
        .
      </p>
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
      {choices.host === "vercel" ? (
        <Note>
          Now put it online with Vercel: open{" "}
          <SiteLink className={link} href="https://vercel.com/new" target="_blank" rel="noopener noreferrer">
            vercel.com/new
          </SiteLink>
          , connect your {github ? "GitHub" : "GitLab"} account if you haven't already, and import {created.repo}. Its
          settings are already in the site's vercel.ts.
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
        {github && (
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
