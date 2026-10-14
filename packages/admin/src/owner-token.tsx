import { EditorsError } from "@goodfellow-cms/core";
import { type ReactNode, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { SignInProblem } from "./sign-in.js";
import { useStrings } from "./strings.js";
import { Button, ErrorMessage, TextField } from "./ui.js";

/**
 * Asks an owner to sign in for changing editors and Pages settings, which
 * everyday sign-in can't, where the host can, with the owner token form below.
 * It's used for this tab only.
 */
export function OwnerTokenForm({ onReady }: { onReady: () => void }) {
  const t = useStrings();
  const { ownerAccess, account } = useAdmin();
  const host = account?.hostName ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(ownerAccess?.problem);
  if (!ownerAccess) return null;
  if (!ownerAccess.startRedirect) return <OwnerTokenFields onReady={onReady} />;

  const signIn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await ownerAccess.startRedirect?.();
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  };

  return (
    <section className="gfa-form gfa-owner-token">
      <h2 className="gfa-section-title">{t("owner.signIn.title")}</h2>
      <p>{t("owner.signIn.intro", { host })}</p>
      {error !== undefined && <SignInProblem error={error} host={host} />}
      <div>
        <Button variant="primary" disabled={busy} onClick={() => void signIn()}>
          {t("owner.signIn.button", { host })}
        </Button>
      </div>
      <details className="gfa-sign-in-token">
        <summary>{t("owner.signIn.orToken")}</summary>
        <OwnerTokenFields onReady={onReady} heading={false} />
      </details>
    </section>
  );
}

/** The owner token form: where to create one, and a field to paste it into. */
function OwnerTokenFields({ onReady, heading = true }: { onReady: () => void; heading?: boolean }): ReactNode {
  const t = useStrings();
  const { ownerAccess, account } = useAdmin();
  const host = account?.hostName ?? "";
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!ownerAccess) return null;

  const use = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await ownerAccess.applyToken(token);
      setToken("");
      onReady();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Not a <form>: screens show this inside their own forms, and forms can't be nested.
    <section className={heading ? "gfa-form gfa-owner-token" : "gfa-form"}>
      {heading && <h2 className="gfa-section-title">{t("owner.token.title")}</h2>}
      <p>{t("owner.token.intro", { host })}</p>
      <ol>
        <li>
          <a href={ownerAccess.tokenLink.url} target="_blank" rel="noreferrer">
            {t(ownerAccess.tokenLink.label, { host })}
          </a>{" "}
          {t("owner.token.chooseSite", { host })}
        </li>
        <li>{t("owner.token.paste")}</li>
      </ol>
      <TextField
        label={t("owner.token.label")}
        type="password"
        autoComplete="off"
        value={token}
        onChange={setToken}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (token.trim()) void use();
        }}
      />
      {error !== undefined && (
        <ErrorMessage
          message={t(error instanceof EditorsError ? "owner.token.error" : "editors.error.other")}
          error={error}
        />
      )}
      <div>
        <Button variant="primary" disabled={busy || !token.trim()} onClick={() => void use()}>
          {busy ? t("owner.token.checking") : t("owner.token.use")}
        </Button>
      </div>
    </section>
  );
}

/** Says an owner token is in use in this tab, with a way to stop using it. */
export function OwnerTokenActive({ onForget }: { onForget: () => void }) {
  const t = useStrings();
  const { ownerAccess } = useAdmin();
  if (!ownerAccess?.active) return null;
  return (
    <p className="gfa-notice">
      {t("owner.token.active")}{" "}
      <Button
        variant="ghost"
        onClick={() => {
          ownerAccess.forget();
          onForget();
        }}
      >
        {t("owner.token.forget")}
      </Button>
    </p>
  );
}
