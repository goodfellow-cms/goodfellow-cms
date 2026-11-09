"use client";

import { authClient } from "@/lib/auth-client";

/** Who's signed in, read in the browser, so the page itself stays the same for everyone. */
export function SignedInAs() {
  const { data } = authClient.useSession();
  if (!data) return <p>Signed in.</p>;
  return (
    <p>
      Signed in as {data.user.name}. <a href="/sign-out/">Sign out</a>
    </p>
  );
}
