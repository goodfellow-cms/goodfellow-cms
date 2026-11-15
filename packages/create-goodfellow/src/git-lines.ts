// What a new site's folder is as git sees it, and what's left to do, in the words both ways of making a site use.
import type { CommitResult, GitResult } from "./scaffold.js";

/** What happened with git, and what's left to do. */
export function gitLines(git: GitResult, commit: CommitResult | undefined, installed: boolean): string[] {
  if (!git.created) {
    return [
      git.reason === "inside-repository"
        ? "It's inside another git repository, so it isn't one of its own."
        : "Git isn't installed, so it isn't a git repository yet: once it is, run git init -b main in it, then commit.",
    ];
  }
  const repository = "It's a git repository on the branch main";
  const origin = git.remote ? [`Its origin is ${git.remote}.`] : [];
  if (commit === "committed") {
    return [
      `${repository}, with everything in its first commit.`,
      ...origin,
      ...(installed ? [] : ["Commit package-lock.json after npm install: the deploy setups need it."]),
    ];
  }
  if (commit === "no-identity") {
    return [
      `${repository}, but git doesn't know your name and email yet, so nothing is committed. Tell it, then commit:`,
      '  git config --global user.name "Your Name"',
      "  git config --global user.email you@example.com",
      // Two commands, since Windows PowerShell 5.1 has no &&.
      "  git add -A",
      '  git commit -m "Create the site"',
      ...origin,
    ];
  }
  return [`${repository}. Nothing is committed yet: commit everything once npm install has run.`, ...origin];
}
