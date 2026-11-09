import type { Metadata } from "next";
import { SignedInAs } from "./signed-in-as";

export const metadata: Metadata = { title: "Members", robots: { index: false } };

// A page of the site's own beside Goodfellow's, for people who are signed in. Like every page, it's rendered once
// and served from the cache: proxy.ts sends anyone else to sign in first, and the browser fills in who's here.
export default function MembersPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-4 text-3xl font-semibold">Members</h1>
      <SignedInAs />
    </main>
  );
}
