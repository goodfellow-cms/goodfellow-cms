"use client";

import { SignOutForm, signInAddress } from "@/lib/account-links";
import { authClient } from "@/lib/auth-client";

/** Who's signed in, read in the browser, so the page itself stays the same for everyone. */
export function SignedInAs() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return null;
  // A session can end after proxy.ts checked it, such as when the page is left open.
  if (!data) return <a href={signInAddress("/members/")}>Sign in to see this page.</a>;
  return (
    <div className="flex flex-wrap gap-1">
      Signed in as {data.user.name}. <SignOutForm label="Sign out" />
    </div>
  );
}
