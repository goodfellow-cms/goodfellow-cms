import type { Metadata } from "next";
import { PaymentsScreen } from "./payments-screen";
import "@/app/site.css";

export const metadata: Metadata = { title: "Payments", robots: { index: false } };

// The same for everyone, so it's rendered once: proxy.ts sends people who aren't signed in to sign in, and the
// screen reads the Buy buttons and their prices from /api/payments/, which answers the site's admins only.
export default function PaymentsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="mb-2">
        <a href="/admin/">Back to the admin panel</a> · <a href="/admin/subscribers/">Subscribers</a> ·{" "}
        <a href="/admin/editors/">Editors</a> · <a href="/account/">Your account</a>
      </p>
      <h1 className="mb-6 text-2xl font-semibold">Payments</h1>
      <PaymentsScreen />
    </main>
  );
}
