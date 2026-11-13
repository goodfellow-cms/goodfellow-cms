import type { Metadata } from "next";
import { SignUpForm } from "./sign-up-form";
import "@/app/site.css";

export const metadata: Metadata = { title: "Sign up", robots: { index: false } };

// The same for everyone, so it's rendered once; the form signs up from the browser.
export default function SignUpPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Sign up</h1>
      <SignUpForm />
    </main>
  );
}
