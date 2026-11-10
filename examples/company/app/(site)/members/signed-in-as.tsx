"use client";

import { authClient } from "@/lib/auth-client";

/** Who's signed in, read in the browser, so the page itself stays the same for everyone. */
export function SignedInAs() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return null;
  // A session can end after proxy.ts checked it, such as when the page is left open.
  if (!data) return <a href="/sign-in/?next=/members/">Sign in to see this page.</a>;
  return (
    <form method="post" action="/sign-out/">
      Signed in as {data.user.name}.{" "}
      <button type="submit" className="underline">
        Sign out
      </button>
    </form>
  );
}
