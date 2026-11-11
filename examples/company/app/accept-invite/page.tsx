import type { Metadata } from "next";
import { AcceptInviteForm } from "./accept-invite-form";
import "@/app/site.css";

export const metadata: Metadata = { title: "Accept your invitation", robots: { index: false } };

// The same for everyone, so it's rendered once; the form reads the invitation's link in the browser.
export default function AcceptInvitePage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Accept your invitation</h1>
      <AcceptInviteForm />
    </main>
  );
}
