import type { ReactNode } from "react";
import { site } from "@/lib/site";

// Around the admin panel and sign-in too, so it never needs the content repository: see `language()`.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = await site.language();
  return (
    // A visitor's light or dark choice is put back on <html> before React starts (see the Dark mode switch block).
    <html lang={language} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
