// The repository's own Review status workflow (.github/workflows/review-status.yml), run with bash against a stand-in
// for gh that answers from fixtures and applies --jq with jq, as gh does, page by page.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = join(import.meta.dirname, "../../../.github/workflows/review-status.yml");
const script = (parse(readFileSync(workflow, "utf8")).jobs.status.steps as { run?: string }[])[0]?.run ?? "";

const HEAD = "a".repeat(40);
const REVIEW = "https://github.com/o/r/pull/7#pullrequestreview-1";

/**
 * A stand-in for gh: GET requests answer with $FIXTURES/<the address, with / and ? as _>.json, filtered with --jq where
 * it's given; a status it's asked to set is kept in $STATE/statuses.
 */
const FAKE_GH = `#!/usr/bin/env bash
args=("$@")
if [ "\${args[0]}" = api ] && [ "\${args[1]}" = --method ]; then
  shift 3
  printf '%s\\n' "$*" >> "$STATE/statuses"
  exit 0
fi
address="" filter="" slurp=""
for ((i = 0; i < \${#args[@]}; i++)); do
  case "\${args[i]}" in
    api|--paginate) ;;
    --slurp) slurp=1 ;;
    --jq) i=$((i + 1)); filter="\${args[i]}" ;;
    graphql) address=graphql ;;
    -f|-F) i=$((i + 1)) ;;
    *) [ -z "$address" ] && address="\${args[i]}" ;;
  esac
done
file="$FIXTURES/$(printf '%s' "$address" | tr '/?&=' '____').json"
[ -f "$file" ] || { echo "no fixture for $address" >&2; exit 1; }
if [ -n "$slurp" ]; then jq -s . "$file"
elif [ -n "$filter" ]; then jq -r "$filter" "$file"
else cat "$file"; fi
`;

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The fixture's file name for an address, as the stand-in reads it. */
const fixture = (address: string) => `${address.replace(/[/?&=]/g, "_")}.json`;

/** Runs the workflow's script for one open pull request whose CodeRabbit check passed, with CodeRabbit's reviews. */
function run(reviews: unknown[], threads: unknown[] = []) {
  dir = mkdtempSync(join(tmpdir(), "review-status-"));
  const bin = join(dir, "bin");
  const fixtures = join(dir, "fixtures");
  mkdirSync(bin);
  mkdirSync(fixtures);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  const files: Record<string, unknown> = {
    "repos/o/r/pulls?state=open&per_page=100": [
      {
        number: 7,
        head: { sha: HEAD, repo: { full_name: "o/r" } },
        html_url: "https://github.com/o/r/pull/7",
        labels: [],
        draft: false,
        user: { login: "someone", type: "User" },
      },
    ],
    [`repos/o/r/commits/${HEAD}/status?per_page=100`]: { statuses: [] },
    [`repos/o/r/commits/${HEAD}/check-runs?check_name=CodeRabbit&filter=latest`]: {
      check_runs: [
        {
          app: { slug: "coderabbitai" },
          started_at: "2026-11-16T00:00:00Z",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/o/r/runs/1",
          output: { title: "Review completed" },
        },
      ],
    },
    "repos/o/r/pulls/7/reviews?per_page=100": reviews,
    graphql: {
      data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: threads } } } },
    },
  };
  for (const [address, body] of Object.entries(files))
    writeFileSync(join(fixtures, fixture(address)), JSON.stringify(body));
  const result = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      STATE: dir,
      FIXTURES: fixtures,
      REPO: "o/r",
      GH_TOKEN: "x",
      CLAUDE_REVIEWS: "false",
    },
  });
  let statuses = "";
  try {
    statuses = readFileSync(join(dir, "statuses"), "utf8");
  } catch {
    statuses = "";
  }
  return { ...result, statuses };
}

const review = (body: string, commit = HEAD) => ({
  user: { login: "coderabbitai[bot]" },
  commit_id: commit,
  body,
  html_url: REVIEW,
});

describe.skipIf(process.platform === "win32")("the Review status workflow", () => {
  it("fails CodeRabbit reviewed while its review of the head commit lists findings outside the diff", () => {
    const result = run([review("> **⚠️ Outside diff range comments (2)**\n> ...")]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.statuses).toContain("state=failure");
    expect(result.statuses).toContain("CodeRabbit raised 2 findings outside the diff in this commit");
    expect(result.statuses).toContain(`target_url=${REVIEW}`);
    const one = run([review("**⚠️ Outside diff range comments (1)**")]);
    expect(one.statuses).toContain("CodeRabbit raised 1 finding outside the diff in this commit");
  });

  it("passes once a newer commit's review has none, or where the review had none", () => {
    // Listed on an earlier commit's review, which a newer commit's review replaces.
    const newer = run([
      review("**⚠️ Outside diff range comments (3)**", "b".repeat(40)),
      review("No actionable comments."),
    ]);
    expect(newer.status, newer.stderr).toBe(0);
    expect(newer.statuses).toContain("state=success");
    expect(run([]).statuses).toContain("CodeRabbit reviewed this commit, and its comments are resolved");
    // CodeRabbit can pass a commit without posting a review of it: an earlier commit's findings were dealt with.
    const unposted = run([review("**⚠️ Outside diff range comments (3)**", "b".repeat(40))]);
    expect(unposted.statuses).toContain("state=success");
  });

  it("still fails for an open thread where the review lists none outside the diff", () => {
    const result = run(
      [review("Actionable comments posted: 1")],
      [
        {
          isResolved: false,
          comments: {
            nodes: [{ url: "https://github.com/o/r/pull/7#discussion_r1", author: { login: "coderabbitai" } }],
          },
        },
      ],
    );
    expect(result.statuses).toContain("1 of CodeRabbit's comments is open");
  });
});
