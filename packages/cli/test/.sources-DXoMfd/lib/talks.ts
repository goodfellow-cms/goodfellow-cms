import { defineCollectionSource } from "@goodfellow-cms/core";
export default defineCollectionSource<{ speaker: string }>((options) => ({
  items: async () => [{ slug: "from-the-source", fields: { title: "From the source", speaker: options.speaker, given: "2026-11-01" } }],
  close: async () => { (globalThis as { talksClosed?: number }).talksClosed = 1; },
}));
