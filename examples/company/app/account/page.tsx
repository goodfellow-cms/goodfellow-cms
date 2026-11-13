import type { Metadata } from "next";
import { AccountScreen } from "./account-screen";
import "@/app/site.css";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

// The same for everyone, so it's rendered once: proxy.ts sends people who aren't signed in to sign in, and the
// screen reads whose account it is in the browser.
export default function AccountPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Your account</h1>
      <AccountScreen />
    </main>
  );
}
