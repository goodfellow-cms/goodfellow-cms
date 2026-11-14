import { classNameField } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { AccountLinksView } from "./account-links-client";

export interface AccountLinksProps {
  signInLabel: string;
  accountLabel: string;
  signOutLabel: string;
  className: string;
}

/** The block's name in the site's `blocks`. */
export const ACCOUNT_LINKS_BLOCK = "AccountLinks";

/**
 * Where visitors sign in, or, once they have, open their account and sign out: for the header. Pages are the same
 * for everyone (each is kept once it has rendered), so who's signed in is read in the browser, once the page has
 * loaded (`AccountLinksView`).
 */
export const AccountLinks: ComponentConfig<AccountLinksProps> = {
  label: "Sign-in and account links",
  fields: {
    signInLabel: { type: "text", label: "Sign-in link's words" },
    accountLabel: { type: "text", label: "Account link's words" },
    signOutLabel: { type: "text", label: "Sign-out button's words" },
    className: classNameField,
  },
  defaultProps: { signInLabel: "Sign in", accountLabel: "Your account", signOutLabel: "Sign out", className: "" },
  // Plain values only, since it's a Client Component.
  render: ({ signInLabel, accountLabel, signOutLabel, className }) => (
    <AccountLinksView
      signInLabel={signInLabel}
      accountLabel={accountLabel}
      signOutLabel={signOutLabel}
      className={className}
    />
  ),
};
