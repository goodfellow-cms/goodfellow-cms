import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NEXT_SITE_FILES } from "./site-files.js";

const STARTER = join(import.meta.dirname, "../../../templates/next");

describe("NEXT_SITE_FILES", () => {
  it("are the Next.js starter's files as it has them now", () => {
    for (const file of NEXT_SITE_FILES) {
      expect(readFileSync(join(STARTER, file.path), "utf8"), file.path).toBe(file.content);
    }
  });
});
