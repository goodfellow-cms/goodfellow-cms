"use client";

import {
  type CreatedSiteRepository,
  newSetupCode,
  planServerSite,
  type SetupAccount,
  SetupError,
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
import { PutOnline } from "./server-site-online";
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
 * The repositories this tab created for a site it didn't finish, kept in the tab until the site is made. A sign-in
 * can connect only the repositories it created itself, so after a reload, after signing in again, or where GitHub made
 * a repository but the rest of its setup failed, the page can't finish that site: it says so, rather than leave
 * repositories nobody knows were made. The setup code is never kept here: it stays in the page's memory only.
 */
const UNFINISHED_KEY = "goodfellow:setup:full-stack:unfinished";

/**
 * The repositories made for a site the page can't finish, by their paths, and the name the site was given: `repos`,
 * which the host said it made, and `maybe`, which the page asked for and never heard about, as when it was reloaded
 * while waiting, so they may or may not be there.
 */
export interface Unfinished {
  name: string;
  repos: string[];
  maybe?: string[];
}

const REPO_PATH = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** What the tab kept as `UNFINISHED_KEY`, where it reads as one. */
export function keptUnfinished(text: string | null): Unfinished | undefined {
  try {
    const { name, repos, maybe = [] } = JSON.parse(text ?? "") as Partial<Unfinished>;
    const paths = (list: unknown) =>
      Array.isArray(list) && list.every((repo) => typeof repo === "string" && REPO_PATH.test(repo));
    if (typeof name === "string" && paths(repos) && paths(maybe) && (repos?.length ?? 0) + maybe.length > 0) {
      return { name, repos: repos ?? [], ...(maybe.length > 0 && { maybe }) };
    }
  } catch {
    // Nothing kept, or nothing this page can read.
  }
  return undefined;
}

/** Changes what the tab keeps, keeping every other site's: trying another name keeps what the ones before made. */
function changeKept(name: string, change: (kept: { repos: string[]; maybe: string[] }) => Unfinished): void {
  try {
    const kept = keptUnfinished(sessionStorage.getItem(UNFINISHED_KEY));
    const next = change({ repos: kept?.repos ?? [], maybe: kept?.maybe ?? [] });
    const maybe = (next.maybe ?? []).filter((repo) => !next.repos.includes(repo));
    if (next.repos.length + maybe.length > 0) {
      sessionStorage.setItem(UNFINISHED_KEY, JSON.stringify({ name, repos: next.repos, maybe } satisfies Unfinished));
    } else sessionStorage.removeItem(UNFINISHED_KEY);
  } catch {
    // Without the tab's storage, a reload forgets them.
  }
}

/** Keeps repositories the host said it made, or, with `made` false, forgets them, made or maybe made. */
function keepUnfinished(name: string, repos: string[], made = true): void {
  changeKept(name, (kept) =>
    made
      ? { name, repos: [...kept.repos, ...repos.filter((repo) => !kept.repos.includes(repo))], maybe: kept.maybe }
      : {
          name,
          repos: kept.repos.filter((repo) => !repos.includes(repo)),
          maybe: kept.maybe.filter((repo) => !repos.includes(repo)),
        },
  );
}

/** Keeps a repository the page is about to ask for, until the host says whether it made it. */
function keepMaybe(name: string, repo: string): void {
  changeKept(name, (kept) => ({
    name,
    repos: kept.repos,
    maybe: [...kept.maybe.filter((path) => path !== repo), repo],
  }));
}

/** A repository's page on GitHub, from its path. */
function githubRepo(repo: string): CreatedSiteRepository {
  return { repo, webUrl: `https://github.com/${repo}`, buildsUrl: `https://github.com/${repo}/actions`, warnings: [] };
}

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
   * The code's repository, once it's created, with the setup code whose hash it has, the answers it was made with and
   * the sign-in that made it: trying again with that sign-in, after the content's repository failed before GitHub made
   * it, carries on with all of them, whatever's been typed since.
   */
  const [begun, setBegun] = useState<Begun>();
  /** Repositories made for a site this page can't finish (`UNFINISHED_KEY`). */
  const [unfinished, setUnfinished] = useState<Unfinished>();
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
      // Repositories made before a reload, or before signing in again, for a site that wasn't finished.
      const kept = keptUnfinished(sessionStorage.getItem(UNFINISHED_KEY));
      if (kept) {
        setUnfinished(kept);
        setName(kept.name);
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
        // The account the repositories made before a reload are in, where there are some.
        let kept: Unfinished | undefined;
        try {
          kept = keptUnfinished(sessionStorage.getItem(UNFINISHED_KEY));
        } catch {
          kept = undefined;
        }
        const keptOwner = found.find((candidate) => kept?.repos[0]?.startsWith(`${candidate.path}/`));
        setOwner(keptOwner?.path ?? found[0]?.path ?? "");
      })
      .catch((caught: unknown) => setError(createMessage(caught)));
  }, [account]);

  const chosenOwner = owners.find((candidate) => candidate.path === owner);
  const validName = /^[A-Za-z0-9._-]+$/.test(name) && !/^[.-]/.test(name);
  // Left empty, the site is at the address Cloudflare gives its Worker, which Set up Cloudflare writes in.
  const typedAddress = address.trim() === "" ? { address: "" } : siteAddressOf(address);
  // Carrying on with the code's repository made before, where the same sign-in, account and name are chosen again.
  const resumed =
    begun && begun.account === account && begun.repo.repo === `${chosenOwner?.path}/${name}` ? begun : undefined;

  useEffect(() => {
    // Another sign-in can't connect the code's repository this one made, so the site can't be finished now.
    if (!begun || begun.account === account) return;
    setBegun(undefined);
    setUnfinished((before) => withRepos(before, begun.answers.name, [begun.repo.repo]));
  }, [account, begun]);
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
    // Deleted since, as the page says to do to change its settings: the site is made afresh, from what's typed, so
    // the page shows its settings again rather than make only its content, beside a code repository that's gone.
    // Where GitHub can't say, the page waits for it, rather than carry on beside a repository that may be gone.
    const gone = resumed ? await account.isAvailable(chosenOwner, name).catch(() => undefined) : false;
    if (gone === undefined && resumed) {
      setError(`GitHub couldn't say whether ${resumed.repo.repo} is still there. Try again in a moment.`);
      setBusy(false);
      return;
    }
    if (resumed && gone) {
      setBegun(undefined);
      setAvailable(true);
      keepUnfinished(resumed.answers.name, [resumed.repo.repo], false);
      setError(
        `${resumed.repo.repo} isn't on GitHub any more, so the site will be made afresh. Check its settings, then create it again.`,
      );
      setBusy(false);
      return;
    }
    const code = `${chosenOwner.path}/${name}`;
    const content = `${chosenOwner.path}/${contentName(name)}`;
    // The code's repository has the setup code's hash and the address already, where it was made before.
    const answers =
      resumed?.answers ??
      ({ name, visibility, address: "address" in typedAddress ? typedAddress.address : "" } as const);
    // The repositories GitHub has made for this site, kept in the tab as soon as each is made, so a reload or a failure
    // part way through still says what's there; each is kept as maybe made from just before it's asked for.
    const made = resumed ? [resumed.repo.repo] : [];
    const unsure: string[] = [];
    const keepMade = (repo: string) => {
      if (made.includes(repo)) return;
      made.push(repo);
      keepUnfinished(answers.name, [repo]);
    };
    // What the name check said before it was asked for: free, taken, or nothing yet.
    let trying: { repo: string; free: boolean | undefined } | undefined;
    let codeRepo = resumed?.repo;
    let setupCode = resumed?.setupCode;
    try {
      setupCode ??= await newCode();
      const files = await serverSiteFiles(base, answers, code, content, setupCode.hash);
      const site = { owner: chosenOwner, private: answers.visibility === "private", pages: false };
      setCreating("code");
      if (!codeRepo) {
        trying = { repo: code, free: available };
        keepMaybe(answers.name, code);
        codeRepo = await account.createSite(
          {
            ...site,
            name,
            description: "A full-stack website made with Goodfellow",
            files: fileChanges(files, "code"),
            message: "Create the site",
            more: true,
          },
          setStep,
          keepMade,
        );
        keepMade(code);
      }
      setCreating("content");
      trying = { repo: content, free: contentAvailable };
      keepMaybe(answers.name, content);
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
        keepMade,
      );
      keepUnfinished(answers.name, [code, content], false);
      setBegun(undefined);
      setCreated({
        owner: chosenOwner,
        code: codeRepo,
        content: contentRepo,
        setupCode: setupCode.code,
        address: answers.address,
        worker: workerName(answers.name),
      });
    } catch (caught) {
      setError(createMessage(caught));
      // GitHub may have made the repository without the page hearing so, where its answer never came back.
      if (trying && !made.includes(trying.repo)) {
        const short = trying.repo.slice(chosenOwner.path.length + 1);
        // A name that was taken before, or that GitHub refused as taken, is someone else's: nothing of this page's.
        const theirs = trying.free === false || (caught instanceof SetupError && caught.problem === "name-taken");
        const taken = !theirs
          ? await account.isAvailable(chosenOwner, short).then(
              (free) => !free,
              () => undefined,
            )
          : false;
        // Only GitHub's word (`onCreated`) says the page made a repository: a name that's taken now may be someone
        // else's, made since it was checked, or all along where the request was never sent, so it's a maybe at most.
        if (taken === false) keepUnfinished(answers.name, [trying.repo], false);
        else unsure.push(trying.repo);
      }
      if (codeRepo && setupCode && !made.includes(content) && !unsure.includes(content)) {
        // Only the code's repository is made, by this sign-in, so trying again carries on with it.
        setBegun({ repo: codeRepo, setupCode, answers, account });
      } else if (made.length + unsure.length > 0) {
        // The content's name is taken by what was made, or the code's setup stopped part way: neither can be finished.
        setBegun((before) => (before?.repo.repo === code ? undefined : before));
        setUnfinished((before) => withRepos(before, answers.name, made, unsure));
      }
    } finally {
      setBusy(false);
      setStep(undefined);
      setCreating(undefined);
    }
  }

  if (loading) return <p aria-live="polite">Loading…</p>;
  if (created && account) return <Created created={created} account={account} withToken={withToken} />;

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
          {unfinished.repos.length > 0 && (
            <p>
              This page created <RepoList repos={unfinished.repos} /> for a site it didn't finish, and it can't carry on
              with {unfinished.repos.length > 1 ? "them" : "it"} now. Delete{" "}
              {unfinished.repos.length > 1 ? "each of them" : unfinished.repos[0]} on GitHub (in Settings, at the
              bottom), then create the site again, or choose another name.
            </p>
          )}
          {unfinished.maybe && unfinished.maybe.length > 0 && (
            <p>
              {unfinished.repos.length > 0 ? "It may also have created" : "This page may have created"}{" "}
              <RepoList repos={unfinished.maybe} />, which GitHub never confirmed, or the name may be someone else's.
              Look on GitHub at who made it and when: delete it (in Settings, at the bottom) only where it's yours and
              was made just as you created the site here, then create the site again, or choose another name.
            </p>
          )}
          <button
            type="button"
            className={`${link} justify-self-start`}
            onClick={() => {
              keepUnfinished(unfinished.name, [...unfinished.repos, ...(unfinished.maybe ?? [])], false);
              setUnfinished(undefined);
            }}
          >
            I've deleted {unfinished.repos.length + (unfinished.maybe?.length ?? 0) > 1 ? "them" : "it"}, or I'll choose
            another name
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
  /** The sign-in that made it, the only one that can connect it to the content's. */
  account: SetupAccount;
}

/** The repositories that can't be finished, with more added, each once. */
function withRepos(before: Unfinished | undefined, name: string, repos: string[], maybe: string[] = []): Unfinished {
  const all = [...(before?.repos ?? []), ...repos].filter((repo, at, list) => list.indexOf(repo) === at);
  const unsure = [...(before?.maybe ?? []), ...maybe].filter(
    (repo, at, list) => list.indexOf(repo) === at && !all.includes(repo),
  );
  return { name, repos: all, ...(unsure.length > 0 && { maybe: unsure }) };
}

/** Repositories' links, joined as a list in words. */
function RepoList({ repos }: { repos: string[] }) {
  return repos.map((repo, at) => (
    <span key={repo}>
      {at > 0 && (at === repos.length - 1 ? (at > 1 ? ", and " : " and ") : ", ")}
      <RepoLink repo={githubRepo(repo)} />
    </span>
  ));
}

/** Both repositories, made, with the setup code and the address the code's has. */
interface CreatedSite {
  owner: SetupOwner;
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

/** What's left once both repositories are made, which the page does with the person, step by step. */
function Created({ created, account, withToken }: { created: CreatedSite; account: SetupAccount; withToken: boolean }) {
  const { owner, code, content, setupCode, address, worker } = created;
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
      <PutOnline
        account={account}
        owner={owner}
        code={code}
        content={content}
        setupCode={setupCode}
        address={address}
        worker={worker}
      />
      <h3 className="font-heading text-lg font-semibold">Next</h3>
      <ul className="grid list-disc gap-1 pl-5">
        {!address && (
          <li>
            To use a domain of your own later, put it in place of the workers.dev address as{" "}
            <code>GOODFELLOW_SITE_URL</code> in {code.repo}'s wrangler.jsonc: signing in works only at that address. The
            next deploy gives it to the Worker where its zone is on your Cloudflare account, or says to add it in
            Cloudflare's dashboard (Workers &amp; Pages → {worker} → Settings → Domains &amp; Routes).
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
