import { useStrings } from "./strings.js";
import { ErrorMessage } from "./ui.js";

/** Why a publish didn't go through; `checks` has been explained by the site checks' dialog already. */
export type Failure = { reason: "conflict" | "error" | "checks"; error: unknown } | null;

/** Explains why a publish from a dialog or form didn't go through. */
export function PublishFailure({ failure }: { failure: Failure }) {
  const t = useStrings();
  if (!failure || failure.reason === "checks") return null;
  return (
    <ErrorMessage
      message={t(failure.reason === "conflict" ? "publish.conflict" : "publish.error")}
      error={failure.error}
    />
  );
}
