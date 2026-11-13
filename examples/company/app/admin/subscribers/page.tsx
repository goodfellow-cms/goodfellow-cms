import type { Metadata } from "next";
import { SubscribersScreen } from "./subscribers-screen";
import "@/app/site.css";

export const metadata: Metadata = { title: "Subscribers", robots: { index: false } };

// The same for everyone, so it's rendered once: proxy.ts sends people who aren't signed in to sign in, and the
// screen reads the site's readers from /api/subscribers/, which answers the site's admins only.
export default function SubscribersPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="mb-2">
        <a href="/admin/">Back to the admin panel</a> · <a href="/admin/editors/">Editors</a> ·{" "}
        <a href="/account/">Your account</a>
      </p>
      <h1 className="mb-6 text-2xl font-semibold">Subscribers</h1>
      <SubscribersScreen />
    </main>
  );
}
