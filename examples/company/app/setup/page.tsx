import type { Metadata } from "next";
import { SetupForm } from "./setup-form";
import "@/app/site.css";

export const metadata: Metadata = { title: "Set up the site", robots: { index: false } };

// The same for everyone, so it's rendered once; whether the site can still be set up is the API's to say.
export default function SetupPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-2 text-2xl font-semibold">Set up the site</h1>
      <p className="mb-6">
        Make yourself the site's first admin with the setup code Goodfellow's setup page showed you. It works once, and
        only while the site has no admin.
      </p>
      <SetupForm />
    </main>
  );
}
