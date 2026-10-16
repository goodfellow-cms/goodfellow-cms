import { classNameField, cx } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { SiteCreateForm } from "./site-create-form";
import { SiteSetupForm } from "./site-setup-form";

export interface SiteSetupProps {
  /** Which step of the setup page this is: choosing what kind of site, or signing in and creating it. */
  step: "choose" | "create";
  gitlabClientId: string;
  className: string;
}

/**
 * The setup page's form, which creates a site in someone's GitHub or GitLab
 * account from their browser, as `npm create goodfellow` does on a computer:
 * the choices on `/new-site/`, then signing in and creating on `/new-site/create/`.
 */
export const SiteSetup: ComponentConfig<SiteSetupProps> = {
  label: "Site setup",
  fields: {
    step: {
      type: "radio",
      label: "Step",
      options: [
        { label: "Choose what kind of site", value: "choose" },
        { label: "Sign in and create it", value: "create" },
      ],
    },
    gitlabClientId: {
      type: "text",
      label: "GitLab application ID, for “Sign in with GitLab” (leave empty to sign in with a token)",
    },
    className: classNameField,
  },
  defaultProps: { step: "choose", gitlabClientId: "", className: "" },
  render: ({ step, gitlabClientId, className }) => (
    <div className={cx("mx-auto w-full max-w-3xl", className)}>
      {step === "create" ? <SiteCreateForm gitlabClientId={gitlabClientId} /> : <SiteSetupForm />}
    </div>
  ),
};
