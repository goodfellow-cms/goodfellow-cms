// Updates Goodfellow's Sponsors list: asks GitHub Sponsors who sponsors goodfellow-cms, with the token in
// SPONSORS_TOKEN (a classic token with read:org and read:user, from an owner of the organization), and writes
// .github/sponsors.json and the README's Sponsors section. .github/workflows/sponsors.yml runs it each day and
// publishes what changed. Run it from anywhere in the repository: `node docs/scripts/sponsors.mjs`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OVERRIDES_FILE,
  SPONSORED,
  SPONSORS_FILE,
  SPONSORS_QUERY,
  sponsorsFileText,
  sponsorsList,
  withReadmeSponsors,
} from "./sponsors-list.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const token = process.env.SPONSORS_TOKEN;
if (!token) {
  console.error("Set SPONSORS_TOKEN to a classic token with read:org and read:user from an owner of goodfellow-cms.");
  process.exit(1);
}

async function page(after) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "goodfellow-sponsors",
    },
    body: JSON.stringify({ query: SPONSORS_QUERY, variables: { login: SPONSORED, after } }),
  });
  if (response.status === 401) {
    throw new Error("GitHub refused SPONSORS_TOKEN: it may have expired. Make a new one and save it as the secret.");
  }
  if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}.`);
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`GitHub couldn't list the sponsors: ${body.errors.map((error) => error.message).join("; ")}`);
  }
  const sponsorships = body.data?.organization?.sponsorshipsAsMaintainer;
  if (!sponsorships) throw new Error("GitHub gave no sponsorships. Is the token's owner an owner of goodfellow-cms?");
  return sponsorships;
}

const sponsorships = [];
let after = null;
do {
  const next = await page(after);
  sponsorships.push(...next.nodes);
  after = next.pageInfo.hasNextPage ? next.pageInfo.endCursor : null;
} while (after);

const overridesPath = join(root, OVERRIDES_FILE);
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
const list = sponsorsList(sponsorships, Date.now(), overrides);
writeFileSync(join(root, SPONSORS_FILE), sponsorsFileText(list));
const readmePath = join(root, "README.md");
writeFileSync(readmePath, withReadmeSponsors(readFileSync(readmePath, "utf8"), list));
console.log(
  `${sponsorships.length} sponsorships: ${list.patrons.length} patrons, ${list.organizations.length} organizations, ${list.backers.length} backers listed.`,
);
