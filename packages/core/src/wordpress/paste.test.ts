import { describe, expect, it } from "vitest";
import { htmlBlocks } from "./paste.js";

const table = "<table><tbody><tr><td>Sunday</td><td>10:00</td></tr></tbody></table>";

describe("pasted HTML as the site's blocks", () => {
  it("reads WordPress's block markup by its blocks, without a Section around them", () => {
    const { blocks, notes } = htmlBlocks(
      [
        "<!-- wp:heading -->",
        '<h2 class="wp-block-heading">Mass times</h2>',
        "<!-- /wp:heading -->",
        "<!-- wp:paragraph -->",
        '<p>Every <strong>Sunday</strong>, as on <a href="/calendar">the calendar</a>.</p>',
        "<!-- /wp:paragraph -->",
      ].join("\n"),
      { prefix: "test" },
    );
    expect(blocks.map((block) => block.type)).toEqual(["Heading", "Text"]);
    expect(blocks[0]?.props).toMatchObject({ id: "Heading-test-1", text: "Mass times", level: "h2" });
    expect(blocks[1]?.props.content).toContain('<a href="/calendar">the calendar</a>');
    expect(blocks[1]?.props.content).toContain("<strong>Sunday</strong>");
    expect(notes).toEqual([]);
  });

  it("reads other HTML by its elements, and leaves out what would run code", () => {
    const { blocks, notes } = htmlBlocks(
      '<h3>Visit</h3><p>Come <a href="javascript:alert(1)">in</a>.</p><script>alert(1)</script><img src="https://example.org/door.jpg" alt="The door">',
      { prefix: "test", media: (address) => address.replace("https://example.org/", "/media/") },
    );
    expect(blocks.map((block) => block.type)).toEqual(["Heading", "Text", "Image"]);
    expect(blocks[1]?.props.content).not.toContain("javascript:");
    expect(JSON.stringify(blocks)).not.toContain("alert");
    expect(blocks[2]?.props).toMatchObject({ src: "/media/door.jpg", alt: "The door" });
    expect(notes).toContain("script");
  });

  it("uses only blocks the site has, and gives each block an id of its own", () => {
    expect(htmlBlocks(table, { prefix: "a" }).blocks.map((block) => block.type)).toEqual(["Table"]);
    // Without the Table block, a table comes across as text.
    const withoutTable = htmlBlocks(table, { prefix: "a", blocks: ["Heading", "Text"] }).blocks;
    expect(withoutTable.map((block) => block.type)).toEqual(["Text"]);
    expect(withoutTable[0]?.props.content).toContain("Sunday");
    // Pasting twice gives ids that don't clash.
    const first = htmlBlocks("<p>One</p>").blocks[0]?.props.id;
    const second = htmlBlocks("<p>One</p>").blocks[0]?.props.id;
    expect(first).toMatch(/^Text-paste-[0-9a-f]{8}-1$/);
    expect(first).not.toBe(second);
  });
});
