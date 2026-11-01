/**
 * Site Settings' Security tab's sign-in section: how editors sign in, as the
 * config's backend line says (`withBackendOption()` in core). On GitHub, the
 * site's sign-in service (`signIn`), which owners put online with Cloudflare's
 * Deploy to Cloudflare button and its own setup page; on GitLab and Bitbucket,
 * the OAuth application or consumer the host's own form makes, which this
 * section walks through, with every value to copy, before publishing its id
 * (`clientId`). Neither host can make one for a site from the browser.
 */
import {
  type ConfigBackendHost,
  configAdmin,
  configBackendHost,
  configBackendOption,
  configBroker,
  signInClientIdProblem,
  signInRedirectAddresses,
  signInServiceProblem,
  withBackendOption,
} from "@goodfellow-cms/core";
import { useState } from "react";
import { useSiteContent } from "./admin-context.js";
import { useStrings } from "./strings.js";
import { Button, docsLink, ErrorMessage, TextField } from "./ui.js";

/** Where Goodfellow's sign-in service is, for the Deploy to Cloudflare button. */
export const SIGN_IN_SERVICE_REPOSITORY = "https://github.com/goodfellow-cms/goodfellow-sign-in";
export const DEPLOY_TO_CLOUDFLARE = `https://deploy.workers.cloudflare.com/?url=${SIGN_IN_SERVICE_REPOSITORY}`;

const HOST_NAMES: Record<ConfigBackendHost, string> = { github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket" };

/** The permissions a Bitbucket consumer needs, as Bitbucket's form names them. */
const BITBUCKET_PERMISSIONS = "Account: Read, Repositories: Write, Pull requests: Write, Pipelines: Write";

export function SignInSection({
  config: given,
  contentOnly,
  hostName,
  save,
}: {
  /** The config as it is now, or `null` where it can't be read, such as in a content repository. */
  config: string | null;
  /** Whether the config is in the code's repository, which this sign-in can't publish. */
  contentOnly: boolean;
  /** The signed-in account's host, such as `GitLab`, for a content repository whose config isn't here. */
  hostName: string;
  save: (next: string, message: string) => Promise<void>;
}) {
  const t = useStrings();
  const config = given ?? "";
  const fromAccount = Object.entries(HOST_NAMES).find(([, name]) => name === hostName)?.[0] as
    | ConfigBackendHost
    | undefined;
  const host = (given ? configBackendHost(given) : undefined) ?? (contentOnly ? fromAccount : undefined);
  if (!host) return null;
  const key = host === "github" ? "signIn" : "clientId";
  const current = configBackendOption(config, key);
  const writable = !contentOnly && withBackendOption(config, key, "placeholder-value") !== undefined;
  const publish = async (value: string | undefined, message: string) => {
    const next = withBackendOption(config, key, value);
    if (next === undefined) throw new Error("goodfellow.config.tsx's backend line can't be changed here.");
    await save(next, message);
  };

  return (
    <section className="gfa-form" aria-labelledby="gfa-sign-in">
      <h2 className="gfa-section-title" id="gfa-sign-in">
        {t(host === "github" ? "signInSetup.service.title" : "signInSetup.app.title", { host: HOST_NAMES[host] })}
      </h2>
      {host === "github" ? (
        <ServiceSettings current={current} writable={writable} contentOnly={contentOnly} publish={publish} />
      ) : (
        <AppSettings
          host={host}
          config={config}
          current={current}
          writable={writable}
          contentOnly={contentOnly}
          publish={publish}
        />
      )}
    </section>
  );
}

function Current({ text, remove }: { text: string; remove?: () => Promise<void> }) {
  const t = useStrings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <div className="gfa-form">
      <p className="gfa-notice gfa-notice-success" role="status">
        {text}
      </p>
      {error !== undefined && <ErrorMessage message={t("signInSetup.error")} error={error} />}
      {remove && (
        <div>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                await remove();
              } catch (caught) {
                setError(caught);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("signInSetup.remove")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** What a developer runs where the config is in the code's repository. */
function Command({ command }: { command: string }) {
  const t = useStrings();
  return (
    <>
      <p>{t("signInSetup.contentOnly")}</p>
      <pre>{command}</pre>
    </>
  );
}

function ServiceSettings({
  current,
  writable,
  contentOnly,
  publish,
}: {
  current: string | undefined;
  writable: boolean;
  contentOnly: boolean;
  publish: (value: string | undefined, message: string) => Promise<void>;
}) {
  const t = useStrings();
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState<"invalid" | "unset" | "unreachable">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  if (current) {
    return (
      <Current
        text={t("signInSetup.service.using", { address: current })}
        remove={
          writable ? () => publish(undefined, t("signInSetup.service.removeMessage", { address: current })) : undefined
        }
      />
    );
  }

  const submit = async () => {
    const url = input.trim().replace(/\/+$/, "");
    if (signInServiceProblem(url)) {
      setProblem("invalid");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const origin = new URL(url).origin;
      // The service says whether it has its apps, without anything secret.
      const health = await fetch(`${origin}/health`).then(
        (response) => (response.ok ? (response.json() as Promise<{ ok?: boolean }>) : undefined),
        () => undefined,
      );
      if (!health) {
        setProblem("unreachable");
        return;
      }
      if (health.ok !== true) {
        setProblem("unset");
        return;
      }
      await publish(origin, t("signInSetup.service.message", { address: origin }));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>{t("signInSetup.service.intro")}</p>
      <ol className="gfa-steps">
        <li>
          {t("signInSetup.service.step.deploy")}{" "}
          <a href={DEPLOY_TO_CLOUDFLARE} target="_blank" rel="noopener noreferrer">
            {t("signInSetup.service.deploy")}
          </a>
        </li>
        <li>{t("signInSetup.service.step.setup")}</li>
        <li>{t("signInSetup.service.step.use")}</li>
      </ol>
      <p className="gfa-hint">
        <a href={docsLink("sign-in-service")} target="_blank" rel="noopener noreferrer">
          {t("signInSetup.service.more")}
        </a>
      </p>
      {contentOnly ? (
        <Command command="npx goodfellow sign-in service https://sign-in.your-name.workers.dev" />
      ) : !writable ? (
        <p>{t("signInSetup.handWritten", { key: "signIn" })}</p>
      ) : (
        <form
          className="gfa-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <TextField
            label={t("signInSetup.service.field")}
            hint={t("signInSetup.service.fieldHint")}
            placeholder="https://sign-in.your-name.workers.dev"
            value={input}
            error={problem ? t(`signInSetup.service.problem.${problem}`) : undefined}
            onChange={(value) => {
              setInput(value);
              setProblem(undefined);
            }}
          />
          {error !== undefined && <ErrorMessage message={t("signInSetup.error")} error={error} />}
          <div>
            <Button variant="primary" type="submit" disabled={busy || !input.trim()}>
              {t("signInSetup.service.use")}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const t = useStrings();
  const [copied, setCopied] = useState(false);
  return (
    <div className="gfa-copy-value">
      <span className="gfa-copy-label">{label}</span>
      <code>{value}</code>
      <Button
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => {},
          );
        }}
      >
        {copied ? t("signInSetup.copied") : t("signInSetup.copy")}
      </Button>
    </div>
  );
}

function AppSettings({
  host,
  config,
  current,
  writable,
  contentOnly,
  publish,
}: {
  host: "gitlab" | "bitbucket";
  config: string;
  current: string | undefined;
  writable: boolean;
  contentOnly: boolean;
  publish: (value: string | undefined, message: string) => Promise<void>;
}) {
  const t = useStrings();
  const { content } = useSiteContent();
  const [input, setInput] = useState("");
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const name = HOST_NAMES[host];
  const admin = configAdmin(config);
  const addresses = signInRedirectAddresses(content.settings.url, {
    admin: admin?.url,
    broker: configBroker(config)?.url,
  });

  if (current) {
    return (
      <>
        <Current
          text={t("signInSetup.app.on", { host: name })}
          remove={writable ? () => publish(undefined, t("signInSetup.app.removeMessage", { host: name })) : undefined}
        />
        {addresses.length > 0 && (
          <p className="gfa-hint">
            {t(host === "gitlab" ? "signInSetup.app.gitlab.keep" : "signInSetup.app.bitbucket.keep", {
              addresses: addresses.join(", "),
            })}
          </p>
        )}
      </>
    );
  }

  const submit = async () => {
    const id = input.trim();
    if (signInClientIdProblem(id)) {
      setProblem(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await publish(id, t("signInSetup.app.message", { host: name }));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const title = `Goodfellow ${content.settings.title ?? ""}`.trim().slice(0, 100);
  let steps: React.ReactNode;
  if (host === "gitlab") {
    const web = (configBackendOption(config, "url") ?? "https://gitlab.com").replace(/\/$/, "");
    const project = configBackendOption(config, "project") ?? "";
    const group = project.includes("/") ? project.slice(0, project.lastIndexOf("/")) : undefined;
    steps = (
      <ol className="gfa-steps">
        <li>
          {t("signInSetup.app.gitlab.open")}{" "}
          {group && (
            <>
              <a href={`${web}/groups/${group}/-/settings/applications`} target="_blank" rel="noopener noreferrer">
                {t("signInSetup.app.gitlab.group", { group })}
              </a>{" "}
              {t("signInSetup.or")}{" "}
            </>
          )}
          <a href={`${web}/-/user_settings/applications`} target="_blank" rel="noopener noreferrer">
            {t("signInSetup.app.gitlab.own")}
          </a>
        </li>
        <li>
          {t("signInSetup.app.gitlab.fill")}
          <CopyValue label={t("signInSetup.app.name")} value={title} />
          <CopyValue label={t("signInSetup.app.gitlab.redirect")} value={addresses.join("\n")} />
          <p className="gfa-hint">{t("signInSetup.app.gitlab.settings")}</p>
        </li>
        <li>{t("signInSetup.app.gitlab.copyId")}</li>
      </ol>
    );
  } else {
    const workspace = (configBackendOption(config, "repo") ?? "").split("/")[0] ?? "";
    const callback = admin?.checked
      ? addresses.find((address) => address.startsWith(new URL(admin.url).origin))
      : addresses[0];
    steps = (
      <ol className="gfa-steps">
        <li>
          {t("signInSetup.app.bitbucket.open")}{" "}
          <a
            href={`https://bitbucket.org/${workspace}/workspace/settings/api`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("signInSetup.app.bitbucket.consumers", { workspace })}
          </a>
        </li>
        <li>
          {t("signInSetup.app.bitbucket.fill")}
          <CopyValue label={t("signInSetup.app.name")} value={title} />
          {callback && <CopyValue label={t("signInSetup.app.bitbucket.callback")} value={callback} />}
          <CopyValue label={t("signInSetup.app.bitbucket.permissions")} value={BITBUCKET_PERMISSIONS} />
          <p className="gfa-hint">{t("signInSetup.app.bitbucket.settings")}</p>
        </li>
        <li>{t("signInSetup.app.bitbucket.copyId")}</li>
      </ol>
    );
  }

  return (
    <>
      <p>{t("signInSetup.app.intro", { host: name })}</p>
      {addresses.length === 0 ? <p className="gfa-notice">{t("signInSetup.app.noAddress")}</p> : steps}
      {contentOnly ? (
        <Command command="npx goodfellow sign-in client-id <the id>" />
      ) : !writable ? (
        <p>{t("signInSetup.handWritten", { key: "clientId" })}</p>
      ) : (
        <form
          className="gfa-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <TextField
            label={t(host === "gitlab" ? "signInSetup.app.gitlab.field" : "signInSetup.app.bitbucket.field")}
            value={input}
            error={problem ? t("signInSetup.app.problem", { host: name }) : undefined}
            onChange={(value) => {
              setInput(value);
              setProblem(false);
            }}
          />
          {error !== undefined && <ErrorMessage message={t("signInSetup.error")} error={error} />}
          <div>
            <Button variant="primary" type="submit" disabled={busy || !input.trim()}>
              {t("signInSetup.app.turnOn", { host: name })}
            </Button>
          </div>
          <p className="gfa-hint">{t("signInSetup.app.after", { host: name })}</p>
        </form>
      )}
    </>
  );
}
