import type { SiteContent, SiteProblem } from "@goodfellow-cms/core";
import { describeProblem, type PublishChecks } from "./site-checks.js";
import { useStrings } from "./strings.js";
import { Button, Dialog } from "./ui.js";

function ProblemList({ content, problems }: { content: SiteContent; problems: SiteProblem[] }) {
  const t = useStrings();
  return (
    <ul className="gfa-check-list">
      {problems.map((problem) => (
        <li key={JSON.stringify(problem)}>{describeProblem(t, content, problem)}</li>
      ))}
    </ul>
  );
}

/** Names as a list in the admin panel's language, which it sets on the page: "Jobs, Events, and News". */
function listOf(names: string[]): string {
  const language = typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
  return new Intl.ListFormat(language, { type: "conjunction" }).format(names);
}

/**
 * What the site checks found in a publish: errors it would bring stop it,
 * and the rest, which the editor can publish anyway, are listed to fix first.
 */
export function ChecksDialog({
  checks,
  content,
  onDecide,
}: {
  checks: PublishChecks;
  /** The site as the publish would leave it, for naming where each problem is. */
  content: SiteContent;
  onDecide: (publish: boolean) => void;
}) {
  const t = useStrings();
  const unread = checks.unread ?? [];
  const leftOut = checks.leftOut ?? [];
  const blocked = checks.blocking.length > 0 || unread.length > 0 || leftOut.length > 0;
  const names = unread.map((id) => content.collections.find((one) => one.id === id)?.settings.name ?? id);
  return (
    <Dialog title={t(blocked ? "checks.blocked.title" : "checks.warnings.title")} onClose={() => onDecide(false)}>
      {unread.length > 0 ? (
        <p>{t("checks.unreadSources", { collections: listOf(names) })}</p>
      ) : leftOut.length > 0 ? (
        <p>{t("checks.leftOutItems", { items: listOf(leftOut) })}</p>
      ) : (
        <>
          <p>{t(blocked ? "checks.blocked.intro" : "checks.warnings.intro")}</p>
          <ProblemList content={content} problems={blocked ? checks.blocking : checks.warnings} />
        </>
      )}
      {checks.blocking.length > 0 && checks.warnings.length > 0 && (
        <>
          <p>{t("checks.alsoWarnings")}</p>
          <ProblemList content={content} problems={checks.warnings} />
        </>
      )}
      <div className="gfa-dialog-actions">
        <Button onClick={() => onDecide(false)}>{t("checks.goBack")}</Button>
        {!blocked && (
          <Button variant="primary" onClick={() => onDecide(true)}>
            {t("checks.publishAnyway")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
