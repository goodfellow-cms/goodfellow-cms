import type { Metadata } from "next";
import { EditorsScreen } from "./editors-screen";
import "@/app/site.css";

export const metadata: Metadata = { title: "Editors", robots: { index: false } };

// The same for everyone, so it's rendered once: proxy.ts sends people who aren't signed in to sign in, and the
// screen reads who has an account from /api/editors/, which answers the site's admins only.
export default function EditorsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="mb-2">
        <a href="/admin/">Back to the admin panel</a> · <a href="/admin/subscribers/">Subscribers</a> ·{" "}
        <a href="/account/">Your account</a>
      </p>
      <h1 className="mb-6 text-2xl font-semibold">Editors</h1>
      <EditorsScreen />
    </main>
  );
}
