"use client";

import {
  type CreatedSiteRepository,
  type SetupAccount,
  SetupError,
  type SetupOwner,
  withBase,
} from "@goodfellow-cms/core";
import {
  appInstallUrl,
  appManifestFormAction,
  type CreatedApp,
  checkPublishingApp,
  convertAppManifest,
  PublishingAppError,
  publishingAppManifest,
  publishingAppName,
} from "@goodfellow-cms/github/app";
import { SiteLink, useSite } from "@goodfellow-cms/react";
import { useEffect, useId, useRef, useState } from "react";
import { APP_CHANNEL, APP_RETURN_PATH, appReturnFor, newAppState, setupLink, workersAddressIn } from "./publishing-app";
import { button, input, link, Note } from "./site-setup-ui";

/** Cloudflare's API tokens page, where the "Edit Cloudflare Workers" template is. */
export const CLOUDFLARE_TOKENS = "https://dash.cloudflare.com/profile/api-tokens";

/** How often, and for how long, the page looks for the Worker's address once Set up Cloudflare has started. */
const LOOK_EVERY_MS = 15_000;
const LOOK_FOR_MS = 30 * 60_000;

export interface PutOnlineProps {
  account: SetupAccount;
  owner: SetupOwner;
  code: CreatedSiteRepository;
  content: CreatedSiteRepository;
  setupCode: string;
  /** The site's address, or "" for the Worker's own, which Set up Cloudflare gives it. */
  address: string;
  worker: string;
}

type AppStep =
  | { stage: "start" }
  | { stage: "making" }
  | { stage: "install"; app: CreatedApp }
  | { stage: "done"; slug: string };

/** A link opening in a new tab. */
function Out({ href, children }: { href: string; children: string }) {
  return (
    <SiteLink className={link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </SiteLink>
  );
}

/** Why something the page asked GitHub for didn't happen, in words. */
function problemOf(caught: unknown): string {
  if (caught instanceof PublishingAppError || caught instanceof SetupError) return caught.message;
  return "GitHub couldn't be reached. Try again in a moment.";
}

/**
 * What's left once both repositories are made, done from the page: making the site's publishing app and installing
 * it on the content repository alone, saving its key and the Cloudflare token as the code's secrets, and starting Set
 * up Cloudflare, then the link that makes the first admin. The app's key is only ever in this tab's memory, until
 * it's sealed for GitHub, and the page forgets it once the installation checks out.
 */
export function PutOnline({ account, owner, code, content, setupCode, address, worker }: PutOnlineProps) {
  const { base } = useSite();
  const id = useId();
  const [state] = useState(newAppState);
  const [app, setApp] = useState<AppStep>({ stage: "start" });
  const [appProblem, setAppProblem] = useState<string>();
  const [cloudflare, setCloudflare] = useState("");
  const [cloudflareSaved, setCloudflareSaved] = useState(false);
  const [cloudflareProblem, setCloudflareProblem] = useState<string>();
  const [online, setOnline] = useState<"started" | "by-hand">();
  const [learned, setLearned] = useState<string>();
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const appRef = useRef(app);
  const converting = useRef(false);
  appRef.current = app;
  const siteAddress = address || learned;
  const canSave = Boolean(account.saveSecrets);

  const returnUrl =
    typeof window === "undefined" ? "" : new URL(withBase(APP_RETURN_PATH, base), window.location.href).href;
  const manifest = publishingAppManifest({
    name: publishingAppName(content.repo),
    url: address || code.webUrl,
    redirectUrl: returnUrl,
    setupUrl: returnUrl,
  });

  /**
   * Turns GitHub's code into the app, and saves its id and key as the code's secrets. One at a time: where the app
   * was made again in another tab meanwhile, only the first to come back counts, so a later one failing can't undo it.
   */
  async function made(codeFromGitHub: string) {
    if (converting.current) return;
    converting.current = true;
    setBusy(true);
    setAppProblem(undefined);
    try {
      const created = await convertAppManifest(codeFromGitHub);
      await account.saveSecrets?.(code.repo, {
        GOODFELLOW_APP_ID: String(created.id),
        GOODFELLOW_APP_KEY: created.pem,
      });
      setApp({ stage: "install", app: created });
    } catch (caught) {
      setApp({ stage: "start" });
      setAppProblem(problemOf(caught));
    } finally {
      converting.current = false;
      setBusy(false);
    }
  }

  /** Checks the installation as the site's server will, then forgets the key. */
  async function check(created: CreatedApp) {
    setBusy(true);
    setAppProblem(undefined);
    try {
      await checkPublishingApp({ appId: created.id, privateKey: created.pem, repo: content.repo });
      setApp({ stage: "done", slug: created.slug });
    } catch (caught) {
      setAppProblem(problemOf(caught));
    } finally {
      setBusy(false);
    }
  }

  // What the return page says, in another tab of this browser: only for this page's own state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `made` and `check` read only props, which never change, and the step through a ref.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(APP_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const said = appReturnFor(event.data, state);
      const now = appRef.current;
      if (said?.kind === "created" && now.stage === "making") void made(said.code);
      if (said?.kind === "installed" && now.stage === "install") void check(now.app);
    };
    return () => channel.close();
  }, [state]);

  // The Worker's own address, once Set up Cloudflare has written it into the code's wrangler.jsonc.
  useEffect(() => {
    if (address || online !== "started" || learned || !account.readFile) return;
    const until = Date.now() + LOOK_FOR_MS;
    const timer = setInterval(() => {
      if (Date.now() > until) return clearInterval(timer);
      void account
        .readFile?.(code.repo, "wrangler.jsonc")
        .then((text) => {
          const found = text && workersAddressIn(text);
          if (found) setLearned(found);
        })
        .catch(() => {});
    }, LOOK_EVERY_MS);
    return () => clearInterval(timer);
  }, [account, address, code.repo, learned, online]);

  async function saveCloudflare() {
    setBusy(true);
    setCloudflareProblem(undefined);
    try {
      await account.saveSecrets?.(code.repo, { CLOUDFLARE_API_TOKEN: cloudflare.trim() });
      setCloudflare("");
      setCloudflareSaved(true);
    } catch (caught) {
      setCloudflareProblem(problemOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function putOnline() {
    setBusy(true);
    try {
      setOnline((await account.startWorkflow?.(code.repo, "setup-cloudflare.yml")) ? "started" : "by-hand");
    } catch {
      setOnline("by-hand");
    } finally {
      setBusy(false);
    }
  }

  const appDone = app.stage === "done";
  const workflow = `${code.webUrl}/actions/workflows/setup-cloudflare.yml`;
  const secrets = `${code.webUrl}/settings/secrets/actions`;

  return (
    <ol className="grid list-decimal gap-6 pl-5">
      <li className="grid gap-2">
        <strong>The publishing app.</strong>
        <p>
          The site publishes editors' changes with a GitHub App of its own, which can change {content.repo} and nothing
          else, so nobody makes or renews a token by hand. GitHub makes it in a new tab, where you choose{" "}
          <strong>Create GitHub App</strong>
          {owner.kind === "organization" ? `, as an owner of ${owner.path}` : ""}.
        </p>
        {!canSave && (
          <Note tone="warning">
            This sign-in can't save secrets, so make the app by hand, as the code's README says under Publishing.
          </Note>
        )}
        {app.stage === "start" || app.stage === "making" ? (
          <form
            ref={form}
            method="post"
            action={appManifestFormAction(state, owner.kind === "organization" ? owner.path : undefined)}
            target="_blank"
            onSubmit={() => setApp({ stage: "making" })}
            rel="noopener"
          >
            <input type="hidden" name="manifest" value={JSON.stringify(manifest)} />
            <button type="submit" className={button} disabled={busy || !canSave}>
              {app.stage === "making" ? "Make the app again" : "Make the publishing app"}
            </button>
          </form>
        ) : null}
        {app.stage === "making" && !busy && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Waiting for GitHub: once you've created the app there, this page carries on.
          </p>
        )}
        {app.stage === "install" && (
          <div className="grid justify-items-start gap-2">
            <p>
              Made, and its key saved in {code.repo}'s secrets. Now install it: choose{" "}
              <strong>Only select repositories</strong>, then <strong>{content.repo}</strong> alone. Installed on any
              other, the site won't publish, since the app could change those too.
            </p>
            <SiteLink
              className={button}
              href={`${appInstallUrl(app.app.slug)}?${new URLSearchParams({ state })}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Install it on {content.repo}
            </SiteLink>
            <button type="button" className={link} disabled={busy} onClick={() => void check(app.app)}>
              I've installed it: check again
            </button>
          </div>
        )}
        {appDone && (
          <p aria-live="polite">Installed on {content.repo} alone, with nothing more: the site can publish with it.</p>
        )}
        {busy && app.stage !== "start" && !appDone && (
          <p className="text-sm" aria-live="polite">
            Checking with GitHub…
          </p>
        )}
        {appProblem && <Note tone="warning">{appProblem}</Note>}
      </li>

      <li className="grid gap-2">
        <strong>Cloudflare.</strong>
        <p>
          On <Out href={CLOUDFLARE_TOKENS}>Cloudflare's API tokens page</Out>, create a token from the{" "}
          <strong>Edit Cloudflare Workers</strong> template, add <strong>Account → D1 → Edit</strong> to its
          permissions, since the template leaves out the site's database, keep it to your account only (under Account
          Resources), and paste it here. The page saves it in {code.repo}'s secrets, which give it to its workflows
          only, and forgets it.
        </p>
        {cloudflareSaved ? (
          <p aria-live="polite">
            Saved in {code.repo}'s secrets.{" "}
            <button type="button" className={link} onClick={() => setCloudflareSaved(false)}>
              Replace it
            </button>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-cloudflare`}>
              Cloudflare API token
            </label>
            <input
              id={`${id}-cloudflare`}
              type="password"
              autoComplete="off"
              className={`${input} max-w-md`}
              placeholder="Paste the Cloudflare token here"
              value={cloudflare}
              onChange={(event) => setCloudflare(event.target.value)}
            />
            <button
              type="button"
              className={button}
              disabled={busy || !canSave || cloudflare.trim() === ""}
              onClick={() => void saveCloudflare()}
            >
              Save it
            </button>
          </div>
        )}
        {cloudflareProblem && <Note tone="warning">{cloudflareProblem}</Note>}
        {!canSave && (
          <p className="text-sm">
            Or add it yourself, as <code>CLOUDFLARE_API_TOKEN</code>, in{" "}
            <Out href={secrets}>{`${code.repo}'s secrets`}</Out>.
          </p>
        )}
      </li>

      <li className="grid gap-2">
        <strong>Put it online.</strong>
        <p>
          Set up Cloudflare makes the site's database and cache, then the Deploy workflow builds the site and puts it
          online{address ? `, at ${new URL(address).host} where its domain is on your Cloudflare account` : ""}. Both
          take a few minutes.
        </p>
        {online === "started" ? (
          <p aria-live="polite">
            Started: follow it on <Out href={`${code.webUrl}/actions`}>{`${code.repo}'s Actions`}</Out>.
          </p>
        ) : online === "by-hand" ? (
          <Note tone="warning">
            This sign-in can't start it, so run <Out href={workflow}>Set up Cloudflare</Out> yourself (Run workflow).
          </Note>
        ) : (
          <button
            type="button"
            className={`${button} justify-self-start`}
            disabled={busy || !appDone || !cloudflareSaved}
            onClick={() => void putOnline()}
          >
            Put the site online
          </button>
        )}
      </li>

      <li className="grid gap-2">
        <strong>The first admin.</strong>
        {siteAddress ? (
          <p>
            Once the site is online, <Out href={setupLink(siteAddress, setupCode)}>{`open ${siteAddress}/setup/`}</Out>{" "}
            with this link, which gives it the setup code, then give your email address, your name, and a password. Sign
            in and turn on two-factor sign-in on your account page straight away.
          </p>
        ) : (
          <p>
            Once Set up Cloudflare has given the site its address,{" "}
            <code>{`https://${worker}.<your-subdomain>.workers.dev`}</code>, a link to its <code>/setup/</code> page
            shows here. Or open it yourself and give the setup code.
          </p>
        )}
      </li>
    </ol>
  );
}
