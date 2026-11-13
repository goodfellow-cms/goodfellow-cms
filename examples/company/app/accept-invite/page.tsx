import type { Metadata } from "next";
import { AcceptInviteForm } from "./accept-invite-form";
import "@/app/site.css";

export const metadata: Metadata = { title: "Choose your password", robots: { index: false } };

// The same for everyone, so it's rendered once; the form reads the link in the browser: an invitation's, or that of
// a reader who signed up (lib/sign-up.ts).
export default function AcceptInvitePage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Choose your password</h1>
      <AcceptInviteForm />
    </main>
  );
}
