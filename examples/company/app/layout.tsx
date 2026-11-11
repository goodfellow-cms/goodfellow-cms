import type { ReactNode } from "react";
import { site } from "@/lib/site";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { settings } = await site.loadSite();
  return (
    // A visitor's light or dark choice is put back on <html> before React starts (see the Dark mode switch block).
    <html lang={settings.language} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
