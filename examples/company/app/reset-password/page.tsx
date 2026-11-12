import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";
import "@/app/site.css";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

// The same for everyone, so it's rendered once: without a link from an email it asks for an address to send one to,
// and with one it takes the new password.
export default function ResetPasswordPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Choose a new password</h1>
      <ResetPasswordForm />
    </main>
  );
}
