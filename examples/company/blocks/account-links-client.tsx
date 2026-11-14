"use client";

import { cx } from "@goodfellow-cms/react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * The Sign-in and account links block's links, read in the browser: Sign in, coming back to the page it was pressed
 * on, for someone who isn't signed in, and their account and Sign out for someone who is. Nothing shows until the
 * session has been read, so neither flashes for the other.
 */
export function AccountLinksView({
  signInLabel,
  accountLabel,
  signOutLabel,
  className,
}: {
  signInLabel: string;
  accountLabel: string;
  signOutLabel: string;
  className: string;
}) {
  const { data, isPending } = authClient.useSession();
  // The page to come back to, which the server's HTML can't know, since it's the same on every page.
  const [here, setHere] = useState("/");
  useEffect(() => setHere(window.location.pathname), []);
  const links = cx("flex items-center gap-4 text-sm", className);
  if (isPending) return <div className={links} aria-hidden="true" />;
  if (!data) {
    return (
      <div className={links}>
        <a
          className="font-medium text-primary hover:underline"
          href={`/sign-in/?${new URLSearchParams({ next: here })}`}
        >
          {signInLabel}
        </a>
      </div>
    );
  }
  return (
    <div className={links}>
      <a className="font-medium text-primary hover:underline" href="/account/">
        {accountLabel}
      </a>
      <form method="post" action="/sign-out/">
        <button type="submit" className="text-muted-foreground hover:underline">
          {signOutLabel}
        </button>
      </form>
    </div>
  );
}
