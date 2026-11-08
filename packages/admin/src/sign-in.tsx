import { type GitBackend, type GitHost, type RedirectOptions, SignInError } from "@goodfellow-cms/core";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { type StringKey, useStrings } from "./strings.js";
import { Button, ErrorMessage, TextField } from "./ui.js";

type SignInState =
  | { status: "checking" }
  | { status: "signed-out"; error?: unknown }
  | { status: "signed-in"; backend: GitBackend };

function errorMessage(error: unknown): StringKey {
  if (error instanceof SignInError) return `signIn.error.${error.problem}` as StringKey;
  return "signIn.error.other";
}

/** Problems with signing in by going to the host, which signing in with a token gets around. */
const REDIRECT_PROBLEMS = new Set(["not-installed", "no-address", "wrong-address", "local-address", "unavailable"]);

/**
 * Explains why signing in didn't work. Where Goodfellow isn't installed yet,
 * `onInstall` offers to install it, which signs the person in too; otherwise
 * it links to where it's fixed.
 */
export function SignInProblem({
  error,
  host,
  expired,
  onInstall,
}: {
  error: unknown;
  host: string;
  expired?: boolean;
  onInstall?: () => void;
}) {
  const t = useStrings();
  const link = error instanceof SignInError ? error.link : undefined;
  const installable = onInstall && error instanceof SignInError && error.problem === "not-installed";
  return (
    <>
      <ErrorMessage
        message={
          expired && error instanceof SignInError && error.problem === "invalid"
            ? t("signIn.error.expired")
            : t(errorMessage(error), { host })
        }
        error={error}
      />
      {installable ? (
        <div>
          <Button variant="primary" onClick={onInstall}>
            {t("signIn.install", { host })}
          </Button>
        </div>
      ) : (
        link && (
          <p>
            <a href={link} target="_blank" rel="noreferrer">
              {t("signIn.install", { host })}
            </a>
          </p>
        )
      )}
    </>
  );
}

/** Where the editor's choice not to stay signed in is kept for the tab, so a sign-in that comes back with a problem keeps it. */
export const REMEMBER_CHOICE_KEY = "goodfellow.signIn.remember";

/** Whether to stay signed in: on, unless the editor turned it off in this tab. */
export function rememberChoice(storage: Pick<Storage, "getItem"> | undefined = tabStorage()): boolean {
  try {
    return storage?.getItem(REMEMBER_CHOICE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Keeps the editor's choice for the tab. Only a yes or no, never a sign-in. */
export function keepRememberChoice(
  remember: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = tabStorage(),
): void {
  try {
    if (remember) storage?.removeItem(REMEMBER_CHOICE_KEY);
    else storage?.setItem(REMEMBER_CHOICE_KEY, "off");
  } catch {
    // Without storage, a sign-in that comes back with a problem starts with it on again.
  }
}

function tabStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function SignInScreen({
  host,
  error,
  onSignedIn,
}: {
  host: GitHost;
  error?: unknown;
  onSignedIn: (backend: GitBackend) => void;
}) {
  const t = useStrings();
  const [token, setToken] = useState("");
  // On unless the editor turns it off, as on a shared computer, which this tab remembers through a sign-in at the host.
  const [remember, setRememberState] = useState(rememberChoice);
  const setRemember = (value: boolean) => {
    setRememberState(value);
    keepRememberChoice(value);
  };
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(error);
  const values = { host: host.name };

  // When signing in by going to the host can't work, the token form is the way in, so it's shown open.
  const redirectFailed = failure instanceof SignInError && REDIRECT_PROBLEMS.has(failure.problem);

  const redirect = async (options?: RedirectOptions) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await host.startRedirect(remember, options);
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(undefined);
    try {
      onSignedIn(await host.signInWithToken(token, remember));
    } catch (caught) {
      setFailure(caught);
      setBusy(false);
    }
  };

  const remembered = (
    <label className="gfa-checkbox">
      <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
      <span>
        {t("signIn.remember")}
        <span className="gfa-hint gfa-block">{t("signIn.rememberHint")}</span>
      </span>
    </label>
  );

  return (
    <div className="gfa-sign-in">
      <h1>{t("signIn.title")}</h1>
      <p>{t("signIn.intro", values)}</p>
      {failure !== undefined && (
        <SignInProblem
          error={failure}
          host={host.name}
          expired={error === failure}
          onInstall={() => void redirect({ install: true })}
        />
      )}

      {host.canRedirect && (
        <div className="gfa-form">
          {remembered}
          <Button variant="primary" disabled={busy} onClick={() => void redirect()}>
            {t("signIn.redirect", values)}
          </Button>
        </div>
      )}

      {host.tokenLinks && host.tokenLinks.length > 0 && (
        <details className="gfa-sign-in-token" open={!host.canRedirect || redirectFailed}>
          <summary>{t(host.canRedirect ? "signIn.orToken" : "signIn.token.title")}</summary>
          <form className="gfa-form" onSubmit={onSubmit}>
            <ol className="gfa-steps">
              <li>
                <p>{t("signIn.token.step1", values)}</p>
                <ul className="gfa-token-links">
                  {host.tokenLinks.map((link) => (
                    <li key={link.url}>
                      <a href={link.url} target="_blank" rel="noreferrer">
                        {t(link.label, values)}
                      </a>
                      {link.hint && <p className="gfa-hint">{t(link.hint, values)}</p>}
                    </li>
                  ))}
                </ul>
                <p className="gfa-hint">{t("signIn.token.chooseSite", values)}</p>
              </li>
              <li>
                <p>{t("signIn.token.step2")}</p>
                <TextField
                  label={t("signIn.token.label")}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={setToken}
                />
              </li>
            </ol>
            {!host.canRedirect && remembered}
            <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
              {busy ? t("signIn.checking") : t("signIn.submit")}
            </Button>
          </form>
        </details>
      )}
    </div>
  );
}

/**
 * Shows the sign-in screen until someone is signed in to the git host, then
 * renders its children with the connected backend.
 */
export function SignInGate({
  host,
  children,
}: {
  host: GitHost;
  children: (backend: GitBackend, signOut: (error?: unknown) => void) => ReactNode;
}) {
  const t = useStrings();
  const [state, setState] = useState<SignInState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    host.restore().then(
      (backend) => !cancelled && setState(backend ? { status: "signed-in", backend } : { status: "signed-out" }),
      (error: unknown) => !cancelled && setState({ status: "signed-out", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [host]);

  if (state.status === "checking") return <p className="gfa-screen">{t("signIn.checking")}</p>;
  if (state.status === "signed-out") {
    return (
      <SignInScreen
        host={host}
        error={state.error}
        onSignedIn={(backend) => setState({ status: "signed-in", backend })}
      />
    );
  }
  const { backend } = state;
  return children(backend, (error) => {
    backend.signOut();
    setState({ status: "signed-out", error });
  });
}
