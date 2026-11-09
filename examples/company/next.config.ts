import { withGoodfellow } from "@goodfellow-cms/next/config";

// A full-stack site: a server of its own, with its own sign-in, rather than static files.
export default withGoodfellow(
  {
    // Stops `next dev` adding AGENTS.md and CLAUDE.md to the site.
    agentRules: false,
  },
  { server: true },
);
