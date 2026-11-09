import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import "@/app/site.css";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

// The same for everyone, so it's rendered once; the form signs in from the browser.
export default function SignInPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
      <SignInForm />
    </main>
  );
}
