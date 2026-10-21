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
  const blocked = checks.blocking.length > 0;
  return (
    <Dialog title={t(blocked ? "checks.blocked.title" : "checks.warnings.title")} onClose={() => onDecide(false)}>
      <p>{t(blocked ? "checks.blocked.intro" : "checks.warnings.intro")}</p>
      <ProblemList content={content} problems={blocked ? checks.blocking : checks.warnings} />
      {blocked && checks.warnings.length > 0 && (
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
