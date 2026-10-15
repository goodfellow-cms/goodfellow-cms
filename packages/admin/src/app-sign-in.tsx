import type { AppSession, GitBackend } from "@goodfellow-cms/core";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { appServer } from "./app-server.js";
import { useStrings } from "./strings.js";
import { Button, ErrorMessage } from "./ui.js";

type SignedIn = Extract<AppSession, { signedIn: true }>;

type GateState =
  | { status: "checking" }
  | { status: "signed-out"; session?: Extract<AppSession, { signedIn: false }>; error?: unknown; expired?: boolean }
  | { status: "signed-in"; backend: GitBackend; session: SignedIn };

/**
 * Shows the site's own sign-in until someone is signed in to it and allowed to
 * edit, on a full-stack site whose server publishes for them (`api`), then
 * renders its children with a backend that reads and publishes through it.
 */
export function AppSignInGate({
  api,
  children,
}: {
  api: string;
  children: (backend: GitBackend, session: SignedIn, signOut: (error?: unknown) => void) => ReactNode;
}) {
  const t = useStrings();
  const server = useMemo(() => appServer(api), [api]);
  const [state, setState] = useState<GateState>({ status: "checking" });

  const check = useCallback(
    async (expired = false) => {
      try {
        const session = await server.session();
        if (session.signedIn) {
          const signOut = () => {
            if (session.signOut) location.assign(session.signOut);
          };
          setState({ status: "signed-in", session, backend: server.backend(session, signOut) });
        } else {
          setState({ status: "signed-out", session, expired });
        }
      } catch (error) {
        setState({ status: "signed-out", error });
      }
    },
    [server],
  );

  useEffect(() => {
    void check();
  }, [check]);

  if (state.status === "checking") return <p className="gfa-screen">{t("signIn.checking")}</p>;
  if (state.status === "signed-out") {
    const { session, error, expired } = state;
    return (
      <div className="gfa-sign-in">
        <h1>{t("signIn.title")}</h1>
        {error !== undefined ? (
          <ErrorMessage
            message={t("signIn.app.error")}
            error={error}
            action={<Button onClick={() => void check()}>{t("action.tryAgain")}</Button>}
          />
        ) : session?.notAllowed ? (
          <>
            <p>{t("signIn.app.notAllowed")}</p>
            {session.signOut && (
              <div>
                <a className="gfa-button gfa-button-secondary" href={session.signOut}>
                  {t("account.signOut")}
                </a>
              </div>
            )}
          </>
        ) : (
          <>
            <p>{t(expired ? "signIn.app.expired" : "signIn.app.intro")}</p>
            {session && (
              <div>
                <a className="gfa-button gfa-button-primary" href={session.signIn}>
                  {t("signIn.app.button")}
                </a>
              </div>
            )}
          </>
        )}
      </div>
    );
  }
  return children(state.backend, state.session, (error) => {
    if (error === undefined) state.backend.signOut();
    // A sign-in that has ended: say so, with the way back in.
    else void check(true);
  });
}
