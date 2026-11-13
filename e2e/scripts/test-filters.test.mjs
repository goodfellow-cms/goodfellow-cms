import assert from "node:assert/strict";
import { test } from "node:test";
import { testFilters } from "../playwright.config.ts";

// Playwright's command line, as `playwright test` gets it, and the filters it reads from it.
const runs = [
  // A value isn't a filter, whichever way it's given.
  [["test", "tests/company.spec.ts", "--project", "chromium", "--trace", "off"], ["tests/company.spec.ts"]],
  [["test", "preact", "--trace=off", "--workers=2"], ["preact"]],
  [["test", "--trace=off", "next"], ["next"]],
  // `--project` takes every argument up to the next option.
  [["test", "next", "--project", "chromium", "firefox"], ["next"]],
  [
    ["test", "next", "--project", "chromium", "firefox", "--trace", "off", "islands"],
    ["next", "islands"],
  ],
  // Optional values take the next argument unless it's an option, whatever it says, as commander does.
  [["test", "next", "--only-changed", "main"], ["next"]],
  [["test", "next", "--only-changed", "--trace", "off"], ["next"]],
  [["test", "-u", "tests/x.spec.ts"], []],
  [["test", "next", "-u", "all", "--debug"], ["next"]],
  // Nothing after `--` is a filter.
  [["test", "--", "preact"], []],
  [["test", "next", "--", "preact"], ["next"]],
  // Line numbers are left off, and names a plain object has are filters like any other.
  [
    ["test", "next.spec.ts:12", "constructor", "-x"],
    ["next.spec.ts", "constructor"],
  ],
];

test("reads a run's test filters as Playwright does", () => {
  for (const [args, filters] of runs) assert.deepEqual(testFilters(args), filters, args.join(" "));
});

test("can't tell the filters apart after an option it doesn't know, so every server starts", () => {
  assert.equal(testFilters(["test", "next", "--newfangled", "x"]), undefined);
  assert.equal(testFilters(["test", "next", "-j4"]), undefined);
});
