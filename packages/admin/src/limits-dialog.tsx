import { allPages, type LimitProblem, type SiteContent } from "@goodfellow-cms/core";
import { useState } from "react";
import { type Translate, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage } from "./ui.js";

/** What a change outside someone's limits touches, in words. Files that are none of those are named once, together. */
export function describeLimitProblems(t: Translate, content: SiteContent, problems: readonly LimitProblem[]): string[] {
  const described = new Set<string>();
  const pages = allPages(content);
  for (const problem of problems) {
    if (problem.kind === "page") {
      const page = pages.find((found) => found.path === problem.address);
      const title = (page?.content.data.root.props as { title?: unknown } | undefined)?.title;
      described.add(t("limits.page", { name: typeof title === "string" && title ? title : problem.address }));
    } else if (problem.kind === "entry") {
      const collection = content.collections.find((found) => found.id === problem.collection);
      const entry = collection?.entries.find((found) => found.slug === problem.slug);
      const title = entry?.content.fields.title;
      described.add(
        t("limits.entry", {
          name: typeof title === "string" && title ? title : problem.slug,
          collection: collection?.settings.name ?? problem.collection,
        }),
      );
    } else described.add(t(`limits.${problem.kind}`));
  }
  return [...described];
}

/**
 * Changes outside what someone may change: listed, with what they can do
 * instead, submitting them for review where the site can take one.
 */
export function LimitsDialog({
  problems,
  content,
  onSubmit,
  onClose,
}: {
  problems: readonly LimitProblem[];
  content: SiteContent;
  /** Submits the changes for review, giving where it's reviewed; absent where the site can't take a review. */
  onSubmit?: () => Promise<{ url?: string }>;
  onClose: () => void;
}) {
  const t = useStrings();
  const [state, setState] = useState<
    | { type: "asking" }
    | { type: "submitting" }
    | { type: "submitted"; url?: string }
    | { type: "error"; error: unknown }
  >({ type: "asking" });
  const submit = async () => {
    if (!onSubmit) return;
    setState({ type: "submitting" });
    try {
      setState({ type: "submitted", ...(await onSubmit()) });
    } catch (error) {
      setState({ type: "error", error });
    }
  };
  return (
    <Dialog title={t("limits.title")} onClose={onClose}>
      <p>{t("limits.intro")}</p>
      <ul className="gfa-check-list">
        {describeLimitProblems(t, content, problems).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {state.type === "submitted" ? (
        <p role="status">
          {t("limits.submitted")}{" "}
          {state.url && (
            <a href={state.url} target="_blank" rel="noreferrer">
              {t("draft.seeReview")}
            </a>
          )}
        </p>
      ) : (
        <p>{t(onSubmit ? "limits.review" : "limits.noReview")}</p>
      )}
      {state.type === "error" && <ErrorMessage message={t("limits.submitError")} error={state.error} />}
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t(state.type === "submitted" ? "action.close" : "limits.goBack")}</Button>
        {onSubmit && state.type !== "submitted" && (
          <Button variant="primary" disabled={state.type === "submitting"} onClick={() => void submit()}>
            {t(state.type === "submitting" ? "limits.submitting" : "draft.submit")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
