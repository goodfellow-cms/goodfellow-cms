"use client";

import {
  type CreatedSiteRepository,
  newSetupCode,
  planServerSite,
  type SetupAccount,
  type SetupOwner,
  type SetupStep,
  SignInError,
  type SiteFiles,
  setupCodeHash,
  withBase,
  workerName,
} from "@goodfellow-cms/core";
import { githubSetup } from "@goodfellow-cms/github";
import { SiteLink, useSite } from "@goodfellow-cms/react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  createMessage,
  decodeBase64,
  fileChanges,
  namedLockfile,
  RepoLink,
  STEP_LABELS,
  signInMessage,
  TOKEN_PROBLEMS,
  TokenForm,
} from "./site-create-form";
import { CHOOSE_PATH, contentName, VISIBILITIES, type Visibility } from "./site-setup-choices";
import { button, Choice, fetchJson, input, LockfileWarning, link, Note, Question, type Starter } from "./site-setup-ui";

/** The page's answers, kept in the browser tab while someone signs in with GitHub and comes back. */
const ANSWERS_KEY = "goodfellow:setup:full-stack";

/**
 * A code repository this tab created, kept in the tab until the content's is made too. A sign-in can connect only
 * the repositories it created itself, so after a reload or signing in again the page can't finish that site: it says
 * so, rather than leave a repository nobody knows was made, holding the hash of a code nobody saw.
 */
const BEGUN_KEY = "goodfellow:setup:full-stack:begun";

/** What the tab kept as `BEGUN_KEY`, where it reads as one. */
export function keptBegun(text: string | null): Begun | undefined {
  try {
    const kept = JSON.parse(text ?? "") as Partial<Begun>;
    const { repo, setupCode, answers } = kept;
    if (
      typeof repo?.repo === "string" &&
      typeof repo.webUrl === "string" &&
      typeof setupCode?.code === "string" &&
      /^[0-9a-f]{64}$/.test(setupCode.hash ?? "") &&
      typeof answers?.name === "string" &&
      (answers.visibility === "public" || answers.visibility === "private") &&
      typeof answers.address === "string"
    ) {
      return { repo: { ...repo, warnings: repo.warnings ?? [] } as CreatedSiteRepository, setupCode, answers };
    }
  } catch {
    // Nothing kept, or nothing this page can read.
  }
  return undefined;
}

/** Keeps the code repository made, or forgets it, in the tab. */
function keepBegun(begun: Begun | undefined): void {
  try {
    if (begun) sessionStorage.setItem(BEGUN_KEY, JSON.stringify(begun));
    else sessionStorage.removeItem(BEGUN_KEY);
  } catch {
    // Without the tab's storage, a reload starts again.
  }
}

/** Where in Cloudflare's dashboard the token for deploying is made: its "Edit Cloudflare Workers" template. */
const CLOUDFLARE_TOKENS = "https://dash.cloudflare.com/profile/api-tokens";

interface Answers {
  name: string;
  visibility: Visibility;
  address: string;
}

/** The site's address as someone typed it, as an origin, or a problem with it in words. */
export function siteAddressOf(typed: string): { address: string } | { problem: string } {
  let url: URL;
  try {
    url = new URL(typed.trim());
  } catch {
    return { problem: "Type the address as https://www.example.org." };
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username) {
    return { problem: "The site's address is https:// and a domain, such as https://www.example.org." };
  }
  return { address: url.origin };
}

/** The address of GitHub's page that makes a fine-grained token, with its name, owner, and permissions filled in. */
function tokenUrl(owner: string, name: string, description: string, permissions: Record<string, string>): string {
  return `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
    name,
    description,
    target_name: owner,
    ...permissions,
  })}`;
}

/** The full-stack site's files, as `create-goodfellow --server cloudflare` makes them, with the setup code's hash. */
async function serverSiteFiles(
  base: string | undefined,
  answers: Answers,
  code: string,
  content: string,
  hash: string,
): Promise<SiteFiles> {
  const starter = (await fetchJson(withBase("/starters/company.json", base))) as Starter;
  const template: SiteFiles = new Map(
    Object.entries(starter.files).map(([path, file]) => [
      path,
      typeof file === "string" ? file : decodeBase64(file.base64),
    ]),
  );
  const files = planServerSite({
    template,
    name: answers.name,
    versions: starter.versions,
    code,
    content,
    ...(answers.address && { siteUrl: answers.address }),
    setupCodeHash: hash,
    madeBy: "page",
  });
  if (starter.lockfile) files.set("package-lock.json", namedLockfile(starter.lockfile, answers.name));
  return files;
}

export interface ServerSiteFormProps {
  /** The sign-in service's address, for "Sign in with GitHub", or "" to sign in with a token. */
  githubSignIn: string;
}

/**
 * The setup page for full-stack sites (`/new-site/full-stack/`), apart from the one for static sites: signing in to
 * GitHub, the site's name and address, and creating its code and content repositories from the company example, as
 * `create-goodfellow --server cloudflare` does on a computer, connected so the code's builds can read the content.
 * The rest happens on GitHub and Cloudflare, as the page then lists: a few secrets, the Set up Cloudflare workflow, the
 * domain, and the first admin, made on the site's own `/setup/` page with the setup code this page shows once.
 */
export function ServerSiteForm({ githubSignIn }: ServerSiteFormProps) {
  const { base } = useSite();
  const id = useId();
  const host = useMemo(() => githubSetup({ signIn: githubSignIn.trim() || undefined }), [githubSignIn]);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<SetupAccount>();
  const [withToken, setWithToken] = useState(false);
  const [owners, setOwners] = useState<SetupOwner[]>([]);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("my-site");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [address, setAddress] = useState("");
  const [available, setAvailable] = useState<boolean>();
  const [contentAvailable, setContentAvailable] = useState<boolean>();
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(!host.canRedirect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [step, setStep] = useState<SetupStep>();
  const [creating, setCreating] = useState<"code" | "content">();
  /**
   * The code's repository, once it's created, with the setup code whose hash it has and the answers it was made with:
   * trying again after the content's repository failed carries on with all three, whatever's been typed since.
   */
  const [begun, setBegun] = useState<Begun>();
  /** A code repository made before this page was reloaded, which it can't finish (`BEGUN_KEY`). */
  const [unfinished, setUnfinished] = useState<Begun>();
  const [created, setCreated] = useState<CreatedSite>();

  // Only state setters, which never change, so the effect below can name it.
  const failedSignIn = useCallback((caught: unknown) => {
    setError(signInMessage(caught));
    if (caught instanceof SignInError && TOKEN_PROBLEMS.has(caught.problem)) setShowToken(true);
  }, []);

  useEffect(() => {
    // Coming back from signing in, with the answers given before.
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(ANSWERS_KEY);
      sessionStorage.removeItem(ANSWERS_KEY);
      // A code repository made before a reload, or before signing in again, whose content's wasn't.
      const kept = keptBegun(sessionStorage.getItem(BEGUN_KEY));
      if (kept) {
        setUnfinished(kept);
        setName(kept.answers.name);
      }
    } catch {
      saved = null;
    }
    if (!saved) return setLoading(false);
    try {
      const answers = JSON.parse(saved) as Partial<Answers>;
      if (typeof answers.name === "string") setName(answers.name);
      if (answers.visibility === "public" || answers.visibility === "private") setVisibility(answers.visibility);
      if (typeof answers.address === "string") setAddress(answers.address);
    } catch {
      // Answers this page can't read are asked for again.
    }
    host
      .restore()
      .then((restored) => setAccount(restored ?? undefined))
      .catch(failedSignIn)
      .finally(() => setLoading(false));
  }, [host, failedSignIn]);

  useEffect(() => {
    if (!account) return;
    account
      .owners()
      .then((found) => {
        setOwners(found);
        // The account the code repository made before a reload is in, where there is one.
        let kept: Begun | undefined;
        try {
          kept = keptBegun(sessionStorage.getItem(BEGUN_KEY));
        } catch {
          kept = undefined;
        }
        const keptOwner = found.find((candidate) => kept?.repo.repo.startsWith(`${candidate.path}/`));
        setOwner(keptOwner?.path ?? found[0]?.path ?? "");
      })
      .catch((caught: unknown) => setError(createMessage(caught)));
  }, [account]);

  const chosenOwner = owners.find((candidate) => candidate.path === owner);
  const validName = /^[A-Za-z0-9._-]+$/.test(name) && !/^[.-]/.test(name);
  // Left empty, the site is at the address Cloudflare gives its Worker, which Set up Cloudflare writes in.
  const typedAddress = address.trim() === "" ? { address: "" } : siteAddressOf(address);
  // Carrying on with the code's repository made before, where the same account and name are chosen again.
  const resumed = begun && begun.repo.repo === `${chosenOwner?.path}/${name}` ? begun : undefined;
  const codeCreated = resumed !== undefined;

  useEffect(() => {
    setAvailable(undefined);
    setContentAvailable(undefined);
    if (!account || !chosenOwner || !validName) return;
    // Answers for a name that's no longer the one chosen are left out, however late they come.
    let current = true;
    const keep =
      (set: (free: boolean | undefined) => void) =>
      (free: boolean | undefined): void => {
        if (current) set(free);
      };
    const timer = setTimeout(() => {
      account.isAvailable(chosenOwner, name).then(keep(setAvailable), () => keep(setAvailable)(undefined));
      account
        .isAvailable(chosenOwner, contentName(name))
        .then(keep(setContentAvailable), () => keep(setContentAvailable)(undefined));
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [account, chosenOwner, name, validName]);

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
    sessionStorage.setItem(ANSWERS_KEY, JSON.stringify({ name, visibility, address } satisfies Answers));
    try {
      await host.startRedirect({ install });
    } catch (caught) {
      sessionStorage.removeItem(ANSWERS_KEY);
      failedSignIn(caught);
    }
  }

  async function create() {
    if (!account || !chosenOwner || (!resumed && !("address" in typedAddress))) return;
    setBusy(true);
    setError(undefined);
    try {
      const code = `${chosenOwner.path}/${name}`;
      const content = `${chosenOwner.path}/${contentName(name)}`;
      // The code's repository has the setup code's hash and the address already, where it was made before.
      const answers =
        resumed?.answers ??
        ({ name, visibility, address: "address" in typedAddress ? typedAddress.address : "" } as const);
      const made = resumed?.setupCode ?? (await newCode());
      const files = await serverSiteFiles(base, answers, code, content, made.hash);
      const site = { owner: chosenOwner, private: answers.visibility === "private", pages: false };
      setCreating("code");
      const codeRepo =
        resumed?.repo ??
        (await account.createSite(
          {
            ...site,
            name,
            description: "A full-stack website made with Goodfellow",
            files: fileChanges(files, "code"),
            message: "Create the site",
            more: true,
          },
          setStep,
        ));
      if (!resumed) {
        const begunNow = { repo: codeRepo, setupCode: made, answers };
        setBegun(begunNow);
        keepBegun(begunNow);
      }
      setCreating("content");
      const contentRepo = await account.createSite(
        {
          ...site,
          name: contentName(name),
          description: "The content of a full-stack website made with Goodfellow",
          files: fileChanges(files, "content"),
          message: "Create the site's content",
          // The code's Deploy workflow checks the content out, with a deploy key where they're private.
          link: {
            code: codeRepo.repo,
            content,
            private: site.private,
            links: { reads: [{ reader: "code", read: "content", secret: "GOODFELLOW_CONTENT_KEY" }], nightly: [] },
          },
        },
        setStep,
      );
      keepBegun(undefined);
      setCreated({
        code: codeRepo,
        content: contentRepo,
        setupCode: made.code,
        address: answers.address,
        worker: workerName(answers.name),
      });
    } catch (caught) {
      setError(createMessage(caught));
    } finally {
      setBusy(false);
      setStep(undefined);
      setCreating(undefined);
    }
  }

  if (loading) return <p aria-live="polite">Loading…</p>;
  if (created) return <Created created={created} withToken={withToken} />;

  return (
    <div className="grid gap-8">
      <LockfileWarning />
      <Note>
        A full-stack site runs on a Cloudflare Worker with a database: editors sign in with accounts the site keeps
        itself, and readers can sign up and subscribe. It's for organizations that want those, and it needs a Cloudflare
        account. A domain of its own is up to you: without one, it's at the address Cloudflare gives it. For a site
        that's only pages,{" "}
        <SiteLink className={link} href={CHOOSE_PATH}>
          create a static site
        </SiteLink>{" "}
        instead, which needs neither.
      </Note>

      <Question title="Sign in to GitHub">
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
                  Sign in with GitHub
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
                gitName="GitHub"
                github
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
        <>
          <Question title="Name">
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`${id}-owner`}>
                Account or organization
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
                  {chosenOwner.path}, then come back here, signed in.
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
                ? "Use letters, numbers, dashes, dots, and underscores only."
                : (available === false && !codeCreated) || contentAvailable === false
                  ? `There's already one called ${available === false && !codeCreated ? name : contentName(name)}.`
                  : (available || codeCreated) && contentAvailable
                    ? "That name is free."
                    : `The code goes in ${chosenOwner?.path ?? ""}/${name}, and the content in ${chosenOwner?.path ?? ""}/${contentName(name)}. The Worker and its database are called ${workerName(name)}.`}
            </p>
          </Question>

          {resumed ? (
            <Note>
              {resumed.repo.repo} is created already, {VISIBILITIES[resumed.answers.visibility].label.toLowerCase()},
              for {resumed.answers.address || "the address Cloudflare gives its Worker"}, so creating the site again
              makes only its content, with those. To change them, delete {resumed.repo.repo} on GitHub first, or choose
              another name.
            </Note>
          ) : (
            <>
              <Question title="Who can see its files?">
                {(Object.keys(VISIBILITIES) as Visibility[]).map((value) => (
                  <Choice
                    key={value}
                    name={`${id}-visibility`}
                    value={value}
                    current={visibility}
                    onChange={setVisibility}
                    {...VISIBILITIES[value]}
                  />
                ))}
              </Question>

              <Question title="The site's address">
                <label className="sr-only" htmlFor={`${id}-address`}>
                  The site's address
                </label>
                <input
                  id={`${id}-address`}
                  className={`${input} max-w-md`}
                  value={address}
                  placeholder="https://www.example.org"
                  onChange={(event) => setAddress(event.target.value)}
                />
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {"problem" in typedAddress
                    ? typedAddress.problem
                    : `A domain of your own, which you'll connect to the Worker on Cloudflare. Leave it empty to use the address Cloudflare gives the Worker, https://${workerName(name)}.<your-subdomain>.workers.dev, and add a domain later.`}
                </p>
              </Question>
            </>
          )}
        </>
      )}

      {unfinished && (
        <div role="alert" className="grid gap-2 rounded-lg border-2 border-primary bg-muted p-3 text-sm font-medium">
          <p>
            Before this page was reloaded, it created <RepoLink repo={unfinished.repo} /> but not its content, and it
            can't finish that site now. Delete {unfinished.repo.repo} on GitHub (its Settings, at the bottom), then
            create the site again, or choose another name.
          </p>
          <button
            type="button"
            className={`${link} justify-self-start`}
            onClick={() => {
              keepBegun(undefined);
              setUnfinished(undefined);
            }}
          >
            I've deleted it, or I'll choose another name
          </button>
        </div>
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
              (!resumed && !("address" in typedAddress)) ||
              (available === false && !codeCreated) ||
              contentAvailable === false
            }
            onClick={() => void create()}
          >
            Create the site
          </button>
          {step && (
            <p aria-live="polite" className="text-sm">
              {creating === "code" ? "The code's repository: " : "The content's repository: "}
              {STEP_LABELS[step]}…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A code repository that's been created, with what it was made with. */
interface Begun {
  repo: CreatedSiteRepository;
  setupCode: { code: string; hash: string };
  answers: Answers;
}

/** Both repositories, made, with the setup code and the address the code's has. */
interface CreatedSite {
  code: CreatedSiteRepository;
  content: CreatedSiteRepository;
  setupCode: string;
  address: string;
  worker: string;
}

/** A new setup code and its hash. */
async function newCode(): Promise<{ code: string; hash: string }> {
  const code = newSetupCode();
  return { code, hash: await setupCodeHash(code) };
}

/** A link to a page on GitHub or Cloudflare, opening in a new tab. */
function Out({ href, children }: { href: string; children: string }) {
  return (
    <SiteLink className={link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </SiteLink>
  );
}

/** The setup code, shown once, with a button that copies it. */
function SetupCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="alert" className="grid gap-2 rounded-lg border-2 border-primary bg-muted p-3">
      <p className="font-medium">
        The site's setup code, which makes you its first admin. Save it now, such as in your password manager: this page
        shows it only once, and it isn't kept anywhere else.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-background px-2 py-1 font-mono text-lg">{code}</code>
        <button
          type="button"
          className={button}
          onClick={() =>
            void navigator.clipboard.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** What's left once both repositories are made, in order, with links to where each step is done. */
function Created({ created, withToken }: { created: CreatedSite; withToken: boolean }) {
  const { code, content, setupCode, address, worker } = created;
  const owner = code.repo.split("/")[0] ?? "";
  const secretsOf = (repo: CreatedSiteRepository) => `${repo.webUrl}/settings/secrets/actions/new`;
  return (
    <div className="grid gap-4" aria-live="polite">
      <h2 className="font-heading text-2xl font-semibold">Your site has been created</h2>
      <p>
        Its code is in <RepoLink repo={code} />, and its content in <RepoLink repo={content} />. Now put it online:
      </p>
      <SetupCode code={setupCode} />
      {content.warnings.includes("connect-unavailable") && (
        <Note tone="warning">
          The two repositories couldn't be set up to read each other, perhaps because this sign-in can't add deploy keys
          or secrets. As the code's .github/workflows/deploy.yml says, add a read-only deploy key to {content.repo} and
          its private half to {code.repo} as the GOODFELLOW_CONTENT_KEY secret.
        </Note>
      )}
      <ol className="grid list-decimal gap-3 pl-5">
        <li>
          <strong>Cloudflare.</strong> Make an API token on{" "}
          <Out href={CLOUDFLARE_TOKENS}>Cloudflare's API tokens page</Out> from the "Edit Cloudflare Workers" template,
          and add it to <Out href={secretsOf(code)}>{`${code.repo}'s secrets`}</Out> as{" "}
          <code>CLOUDFLARE_API_TOKEN</code>. Add your account's ID there too, as <code>CLOUDFLARE_ACCOUNT_ID</code>:
          it's shown on the dashboard's Workers &amp; Pages page.
        </li>
        <li>
          <strong>Publishing.</strong>{" "}
          <Out
            href={tokenUrl(owner, `Publish ${content.repo}`, `The site's server publishes editors' changes`, {
              contents: "write",
            })}
          >
            Make a fine-grained token
          </Out>{" "}
          for {content.repo} only (under Repository access, choose Only select repositories), and add it to{" "}
          <Out href={secretsOf(code)}>{`${code.repo}'s secrets`}</Out> as <code>GOODFELLOW_GIT_TOKEN</code>. The site
          publishes editors' changes with it, so when it expires, make a new one.
        </li>
        <li>
          <strong>Photos and files.</strong>{" "}
          <Out
            href={tokenUrl(owner, `Deploy ${code.repo}`, "Puts the site online after each publish", {
              actions: "write",
            })}
          >
            Make another fine-grained token
          </Out>{" "}
          for {code.repo} only, and add it to <Out href={secretsOf(content)}>{`${content.repo}'s secrets`}</Out> as{" "}
          <code>GOODFELLOW_DEPLOY_TOKEN</code>. It can start the code's workflows but never change them, so new photos
          reach the site after each publish.
        </li>
        <li>
          <strong>Set up Cloudflare.</strong> In {code.repo}, run{" "}
          <Out href={`${code.webUrl}/actions/workflows/setup-cloudflare.yml`}>Set up Cloudflare</Out> (Run workflow). It
          makes the site's database and cache, names them in wrangler.jsonc, and starts the Deploy workflow, which puts
          the site online. Both take a few minutes.
        </li>
        {address ? (
          <li>
            <strong>The domain.</strong> In <Out href="https://dash.cloudflare.com/">Cloudflare's dashboard</Out>, open
            Workers &amp; Pages → {worker} → Settings → Domains &amp; Routes, and add {new URL(address).host}.
          </li>
        ) : null}
        <li>
          <strong>The first admin.</strong>{" "}
          {address ? (
            <>
              Open <Out href={`${address}/setup/`}>{`${address}/setup/`}</Out>,
            </>
          ) : (
            <>
              Open <code>/setup/</code> at the site's address,{" "}
              <code>{`https://${worker}.<your-subdomain>.workers.dev`}</code>, which the Set up Cloudflare run shows in
              its summary,
            </>
          )}{" "}
          give the setup code, your email address, your name, and a password, then sign in and turn on two-factor
          sign-in on your account page straight away.
        </li>
      </ol>
      <h3 className="font-heading text-lg font-semibold">Next</h3>
      <ul className="grid list-disc gap-1 pl-5">
        {!address && (
          <li>
            To use a domain of your own later, add it to the Worker in Cloudflare's dashboard (Workers &amp; Pages →{" "}
            {worker} → Settings → Domains &amp; Routes), and put it in place of the workers.dev address as{" "}
            <code>GOODFELLOW_SITE_URL</code> in {code.repo}'s wrangler.jsonc: signing in works only at that address.
          </li>
        )}
        <li>
          Email for invitations and password resets, and payments for subscriptions, are set up as the code's README
          says. The site works without them.
        </li>
        {withToken && (
          <li>
            Delete the token you made to sign in to this page, on GitHub's{" "}
            <Out href="https://github.com/settings/personal-access-tokens">fine-grained tokens</Out> or{" "}
            <Out href="https://github.com/settings/tokens">classic tokens</Out> page.
          </li>
        )}
        <li>
          Read{" "}
          <SiteLink className={link} href="/docs/full-stack-cloudflare">
            Full-stack sites on Cloudflare
          </SiteLink>{" "}
          for the rest, including what to do if you lose the setup code.
        </li>
      </ul>
    </div>
  );
}
