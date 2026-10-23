"use client";

import { GoodfellowEditor } from "@goodfellow-cms/next/editor";
import config from "@/goodfellow.config";

// The editor's frames: Puck and the site's blocks, sandboxed away from the admin panel's page.
export default function EditorPage() {
  return <GoodfellowEditor config={config} />;
}
