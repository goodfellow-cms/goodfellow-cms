import type { ReactNode } from "react";
import { site } from "@/lib/site";

export const generateMetadata = site.adminMetadata;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
