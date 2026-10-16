import { setUpContentRepository } from "@goodfellow-cms/core/node";
import { build, preview } from "goodfellow";
import { builtSites, createBuiltSite } from "./site.mjs";

const name = process.argv[2];
const root = createBuiltSite(name);
// As a developer's computer has it: content/ and public/media/ linked to the content repository.
if (builtSites[name].separate) await setUpContentRepository(root);
await build({ root });
await preview({ root, port: builtSites[name].port });
