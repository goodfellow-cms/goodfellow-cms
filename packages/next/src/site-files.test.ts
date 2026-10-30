import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UPDATE_FILES } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { NEXT_SITE_FILES } from "./site-files.js";

const STARTER = join(import.meta.dirname, "../../../templates/next");

describe("NEXT_SITE_FILES", () => {
  it("are the Next.js starter's files as it has them now", () => {
    for (const file of NEXT_SITE_FILES) {
      expect(readFileSync(join(STARTER, file.path), "utf8"), file.path).toBe(file.content);
    }
  });

  it("are files the nightly update's publish job lets an update change", () => {
    for (const file of NEXT_SITE_FILES) expect(UPDATE_FILES, file.path).toContain(file.path);
  });
});
