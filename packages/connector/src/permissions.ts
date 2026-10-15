/** What the Goodfellow for Claude app's tokens may do: change files, open pull requests for review, and read the repository. */
export const PERMISSIONS: Record<string, "read" | "write"> = {
  contents: "write",
  pull_requests: "write",
  metadata: "read",
};
