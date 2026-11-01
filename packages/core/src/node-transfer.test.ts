import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { exportSite, formatSiteImport, importSite, SiteTransferError } from "./node-transfer.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const page = (title: string) => json({ version: 1, data: { root: { props: { title } }, content: [] } });
const folders: string[] = [];

async function site(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "goodfellow-transfer-"));
  folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe("exportSite and importSite", () => {
  it("writes a zip with the manifest, which another site imports", async () => {
    const from = await site({
      "content/site.json": json({ version: 1, title: "St. Brendan", url: "https://stbrendan.example.org/" }),
      "content/pages/index.json": page("Welcome to St. Brendan"),
      "content/pages/contact.json": page("Contact"),
      "content/permissions.json": json({ version: 1, editors: {} }),
      "public/media/church.jpg": "<photo>",
      "public/media/bad.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "src/blocks.tsx": "export {}",
    });
    const into = await site({
      "content/site.json": json({ version: 1, title: "St. Anne", url: "https://stanne.example.org/" }),
      "content/pages/index.json": page("Welcome to St. Anne"),
    });
    const file = join(into, "export.zip");
    const exported = await exportSite(from, file, { now: new Date("2026-11-01T12:00:00Z") });
    expect(exported).toMatchObject({ files: 4, media: 2, stored: 0 });
    const zip = unzipSync(new Uint8Array(await readFile(file)));
    expect(Object.keys(zip).sort()).toEqual([
      "content/pages/contact.json",
      "content/pages/index.json",
      "content/permissions.json",
      "content/site.json",
      "goodfellow-transfer.json",
      "public/media/bad.svg",
      "public/media/church.jpg",
    ]);
    await expect(exportSite(from, file)).rejects.toThrow(SiteTransferError);

    const result = await importSite(into, file, { blocks: [] });
    expect(result.written).toBe(true);
    expect(await readFile(join(into, "content/pages/contact.json"), "utf8")).toBe(page("Contact"));
    expect(await readFile(join(into, "public/media/church.jpg"), "utf8")).toBe("<photo>");
    // An SVG that could run code isn't brought in, nor are editors' limits.
    await expect(readFile(join(into, "public/media/bad.svg"))).rejects.toThrow();
    await expect(readFile(join(into, "content/permissions.json"))).rejects.toThrow();
    // What both have differently stays the site's unless asked.
    expect(await readFile(join(into, "content/pages/index.json"), "utf8")).toBe(page("Welcome to St. Anne"));
    expect(formatSiteImport(result)).toContain("Kept this site's version");

    const taken = await importSite(into, file, { blocks: [], take: "export" });
    expect(await readFile(join(into, "content/pages/index.json"), "utf8")).toBe(page("Welcome to St. Brendan"));
    expect(formatSiteImport(taken)).toContain("Took the export's version");
    expect(JSON.parse(await readFile(join(into, "content/site.json"), "utf8")).url).toBe("https://stanne.example.org/");
  });

  it("reads an unpacked folder, and refuses what isn't a site", async () => {
    const from = await site({
      "my-site/content/site.json": json({ version: 1, title: "St. Brendan" }),
      "my-site/content/pages/about.json": page("About"),
      "notes.txt": "hi",
    });
    const into = await site({ "content/site.json": json({ version: 1, title: "St. Anne" }) });
    const result = await importSite(into, from, { blocks: [], dryRun: true });
    expect(result.written).toBe(false);
    expect(result.plan.changes.map((change) => change.path)).toEqual(["content/pages/about.json"]);
    const empty = await site({ "notes.txt": "hi" });
    await expect(importSite(into, empty, { blocks: [] })).rejects.toThrow(SiteTransferError);
  });
});
