"use client";

import { authClient } from "@/lib/auth-client";

/** Who's signed in, read in the browser, so the page itself stays the same for everyone. */
export function SignedInAs() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return null;
  // proxy.ts only sees that there's a session cookie, which may be for a session that has ended.
  if (!data) return <a href="/sign-in/?next=/members/">Sign in to see this page.</a>;
  return (
    <p>
      Signed in as {data.user.name}. <a href="/sign-out/">Sign out</a>
    </p>
  );
}
