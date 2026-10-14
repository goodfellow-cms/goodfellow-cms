import {
  REDIRECT_LINK_PLACEHOLDER,
  REDIRECT_MESSAGE,
  type Redirect,
  type RedirectProblem,
  redirectFrom,
  redirectProblems,
} from "@goodfellow-cms/core";
import { useId } from "react";
import { type StringKey, useStrings } from "./strings.js";
import { Button, TextField } from "./ui.js";

export const redirectProblemText: Record<RedirectProblem, StringKey> = {
  "no-from": "redirects.problem.noFrom",
  "bad-from": "redirects.problem.badFrom",
  query: "redirects.problem.query",
  home: "redirects.problem.home",
  reserved: "redirects.problem.reserved",
  "no-to": "redirects.problem.noTo",
  "bad-to": "redirects.problem.badTo",
  loop: "redirects.problem.loop",
  duplicate: "redirects.problem.duplicate",
};

function isFilled(redirect: Redirect): boolean {
  return Boolean(redirect.from.trim() || redirect.to.trim());
}

/** Redirects worth saving: rows with nothing typed in them are left out. */
export function filledRedirects(redirects: readonly Redirect[]): Redirect[] {
  return redirects.filter(isFilled);
}

/**
 * Edits the site's redirects: old addresses, such as a moved page's or an
 * earlier website's, and where they send visitors. `taken` lists the
 * addresses that have pages, which win over redirects.
 */
export function RedirectsEditor({
  redirects,
  message,
  taken,
  showErrors,
  onChange,
  onMessageChange,
}: {
  redirects: Redirect[];
  /** What the page at an old address says, or `""` for the default. */
  message: string;
  taken: readonly string[];
  showErrors: boolean;
  onChange: (redirects: Redirect[]) => void;
  onMessageChange: (message: string) => void;
}) {
  const t = useStrings();
  const pagesList = useId();
  // Empty rows have no problems: they're left out when publishing.
  const filled = redirects.flatMap((redirect, index) => (isFilled(redirect) ? [index] : []));
  const filledProblems = redirectProblems(filled.map((index) => redirects[index] as Redirect));
  const problems = new Map(filled.map((index, position) => [index, filledProblems[position]]));
  const update = (index: number, redirect: Redirect) =>
    onChange(redirects.map((existing, i) => (i === index ? redirect : existing)));

  return (
    <div className="gfa-menus">
      <p className="gfa-hint">{t("redirects.intro")}</p>
      {redirects.length === 0 && <p>{t("redirects.empty")}</p>}
      <datalist id={pagesList}>
        {taken.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      {redirects.map((redirect, index) => {
        const problem = problems.get(index);
        const from = redirectFrom(redirect.from);
        const unused = !problem && from.ok && taken.includes(from.path);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: redirects have no ids, and content-based keys would change (and steal focus) on every keystroke
          <div key={index} className="gfa-menu-item">
            <div className="gfa-link-row">
              <TextField
                label={t("redirects.from")}
                placeholder="/about-us"
                value={redirect.from}
                onChange={(value) => update(index, { ...redirect, from: value })}
              />
              <TextField
                label={t("redirects.to")}
                placeholder="/about"
                list={pagesList}
                value={redirect.to}
                onChange={(value) => update(index, { ...redirect, to: value })}
              />
              <div className="gfa-link-row-actions">
                <Button variant="ghost" onClick={() => onChange(redirects.filter((_, i) => i !== index))}>
                  {t("redirects.remove")}
                </Button>
              </div>
            </div>
            {showErrors && problem && (
              <p className="gfa-error-text" role="alert">
                {t(redirectProblemText[problem])}
              </p>
            )}
            {unused && <p className="gfa-hint">{t("redirects.unused")}</p>}
          </div>
        );
      })}
      <div className="gfa-menu-actions">
        <Button onClick={() => onChange([...redirects, { from: "", to: "" }])}>{t("redirects.add")}</Button>
      </div>
      <TextField
        label={t("redirects.message")}
        hint={t("redirects.messageHint", { placeholder: REDIRECT_LINK_PLACEHOLDER })}
        placeholder={REDIRECT_MESSAGE}
        value={message}
        onChange={onMessageChange}
      />
    </div>
  );
}
