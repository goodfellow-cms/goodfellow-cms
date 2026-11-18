import { describe, expect, it } from "vitest";
import { attributeText } from "./html-scan.js";

describe("an attribute's value as a browser reads it", () => {
  it("reads numeric references, with or without their ;, and named ones only with it", () => {
    expect(attributeText("text&#47;html")).toBe("text/html");
    expect(attributeText("text&#x2f;html")).toBe("text/html");
    expect(attributeText("text&#47html")).toBe("text/html");
    expect(attributeText("application&sol;xhtml&plus;xml")).toBe("application/xhtml+xml");
    expect(attributeText("text&solhtml")).toBe("text&solhtml");
    expect(attributeText("text&sol")).toBe("text&sol");
    expect(attributeText("a&unknown;b")).toBe("a&unknown;b");
  });
});
