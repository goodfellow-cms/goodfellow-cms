import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "../../..");

type Step = { if?: string; name?: string; uses?: string; run?: string };
type Workflow = {
  on: { pull_request: { types: string[] } };
  concurrency: { group: string };
  jobs: { company: { if: string; env: Record<string, string>; steps: Step[] } };
};

async function workflow(): Promise<Workflow> {
  return parse(await readFile(join(ROOT, ".github/workflows/fresh-site.yml"), "utf8")) as Workflow;
}

/**
 * Works out a GitHub Actions expression of the forms fresh-site.yml uses: `contains()`, `fromJSON()`, `==`, `!=`, `!`,
 * `&&`, `||`, brackets, strings, and property paths, with `&&` and `||` giving an operand as GitHub's do.
 */
function evaluate(expression: string, context: Record<string, unknown>): unknown {
  const tokens = expression.match(/'(?:[^']|'')*'|&&|\|\||==|!=|[!(),]|[\w.*-]+/g) ?? [];
  let at = 0;
  const peek = () => tokens[at];
  const take = (token?: string) => {
    const next = tokens[at++];
    if (token !== undefined && next !== token) throw new Error(`Expected ${token}, got ${next} in ${expression}`);
    return next;
  };
  const truthy = (value: unknown) =>
    value !== undefined && value !== null && value !== false && value !== "" && value !== 0;
  const lookup = (path: string): unknown => {
    let value: unknown = context;
    for (const part of path.split(".")) {
      if (part === "*") {
        value = Array.isArray(value) ? value : [];
        continue;
      }
      value = Array.isArray(value)
        ? value.map((item) => (item as Record<string, unknown>)?.[part])
        : (value as Record<string, unknown> | undefined)?.[part];
    }
    return value;
  };
  function primary(): unknown {
    const token = take();
    if (token === "!") return !truthy(primary());
    if (token === "(") {
      const value = or();
      take(")");
      return value;
    }
    if (token?.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === "contains" || token === "fromJSON") {
      take("(");
      const first = or();
      if (token === "fromJSON") {
        take(")");
        return JSON.parse(String(first));
      }
      take(",");
      const second = or();
      take(")");
      return Array.isArray(first) ? first.includes(second) : String(first).includes(String(second));
    }
    return lookup(token ?? "");
  }
  function comparison(): unknown {
    const left = primary();
    if (peek() === "==" || peek() === "!=") {
      const equal = take() === "==";
      return (left === primary()) === equal;
    }
    return left;
  }
  function and(): unknown {
    let value = comparison();
    while (peek() === "&&") {
      take();
      const right = comparison();
      value = truthy(value) ? right : value;
    }
    return value;
  }
  function or(): unknown {
    let value = and();
    while (peek() === "||") {
      take();
      const right = and();
      value = truthy(value) ? value : right;
    }
    return value;
  }
  const value = or();
  if (at !== tokens.length) throw new Error(`Couldn't read ${expression}`);
  return value;
}

/** An expression as the workflow writes it, `${{ … }}` inside text, or bare in `if:`. */
function interpolate(text: string, context: Record<string, unknown>): string {
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, inner: string) => String(evaluate(inner.trim(), context)));
}

interface Case {
  event: string;
  action?: string;
  label?: string;
  labels?: string[];
  state?: "open" | "closed";
}

/** What happens to one run: whether its jobs run, which steps, and the concurrency group it joins. */
async function outcome({ event, action, label, labels = [], state = "open" }: Case) {
  const flow = await workflow();
  const context = {
    github: {
      event_name: event,
      run_id: 900,
      event: {
        ...(action && { action }),
        ...(label && { label: { name: label } }),
        ...(event === "pull_request" && {
          pull_request: { number: 311, state, labels: labels.map((name) => ({ name })) },
        }),
      },
    },
  };
  const job = flow.jobs.company;
  const runs = Boolean(evaluate(job.if, context));
  const env = Object.fromEntries(
    Object.entries(job.env).map(([name, value]) => [name, interpolate(String(value), context)]),
  );
  const steps = job.steps.filter((step) => step.if === undefined || evaluate(step.if, { ...context, env }) === true);
  return { runs, group: interpolate(flow.concurrency.group, context), steps };
}

describe("the fresh-site workflow's no-fresh-site label", () => {
  it("runs when a label is added or taken off", async () => {
    expect((await workflow()).on.pull_request.types).toEqual(
      expect.arrayContaining(["opened", "synchronize", "reopened", "labeled", "unlabeled"]),
    );
  });

  it("makes the site on pull requests without the label, and each night", async () => {
    for (const run of [
      await outcome({ event: "pull_request", action: "synchronize", labels: ["claude-reviewed"] }),
      await outcome({ event: "pull_request", action: "unlabeled", label: "no-fresh-site" }),
      await outcome({ event: "schedule" }),
    ]) {
      expect(run.runs).toBe(true);
      expect(run.steps.map((step) => step.name ?? step.run ?? step.uses)).toContain("npm run build");
      expect(run.steps.some((step) => step.name?.startsWith("Skipped"))).toBe(false);
    }
    expect((await outcome({ event: "pull_request", action: "synchronize" })).group).toBe("fresh-site-311");
    expect((await outcome({ event: "schedule" })).group).toBe("fresh-site-900");
  });

  it("passes both Node versions' jobs with every step skipped, in place of the run before, while it's on", async () => {
    for (const run of [
      await outcome({ event: "pull_request", action: "labeled", label: "no-fresh-site", labels: ["no-fresh-site"] }),
      await outcome({ event: "pull_request", action: "synchronize", labels: ["no-fresh-site", "no-coderabbit"] }),
    ]) {
      // The jobs run, so `company (22)` and `company (24)` report: a job skipped whole reports as `company`.
      expect(run.runs).toBe(true);
      expect(run.steps.map((step) => step.name)).toEqual(["Skipped, since the pull request is labelled no-fresh-site"]);
      expect(run.group).toBe("fresh-site-311");
    }
  });

  it("starts nothing when the label goes on or off a closed pull request", async () => {
    for (const action of ["labeled", "unlabeled"]) {
      const run = await outcome({ event: "pull_request", action, label: "no-fresh-site", state: "closed" });
      expect(run.runs).toBe(false);
    }
  });

  it("starts nothing for another label, and cancels no run of the pull request's", async () => {
    for (const action of ["labeled", "unlabeled"]) {
      const run = await outcome({
        event: "pull_request",
        action,
        label: "claude-reviewed",
        labels: ["claude-reviewed"],
      });
      expect(run.runs).toBe(false);
      expect(run.group).toBe("fresh-site-900");
    }
  });
});
