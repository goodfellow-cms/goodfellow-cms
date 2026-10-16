"use client";

import {
  BLOCK_CHOICES,
  type BlockChoice,
  CONTENT_BUILDS,
  contentBuildsFor,
  HOSTS,
  hostsFor,
  TEMPLATES,
  type TemplateName,
} from "@goodfellow-cms/core";
import { SiteLink } from "@goodfellow-cms/react";
import { useEffect, useId, useState } from "react";
import {
  advancedSummary,
  type Choices,
  CONTENT_PLACES,
  type ContentPlace,
  CREATE_PATH,
  choicesQuery,
  chosenKeys,
  GIT_HOSTS,
  type GitHostName,
  gitNote,
  hostProblem,
  PURPOSES,
  type Purpose,
  parseChoices,
  recommendedGit,
  recommendedHost,
  VISIBILITIES,
  type Visibility,
  withDefaults,
} from "./site-setup-choices";
import { button, Choice, LockfileWarning, link, Note, Question } from "./site-setup-ui";

/**
 * The setup page's first step: what kind of site, where its files are kept,
 * and, behind Advanced settings, the rest, each with a default that suits
 * the site. Continue goes to the second step with the choices in its address.
 */
export function SiteSetupForm() {
  const id = useId();
  const [purpose, setPurpose] = useState<Purpose>();
  // Only what people chose themselves: everything else follows from it, so changing the purpose updates the rest.
  const [chosen, setChosen] = useState<Partial<Choices>>({});
  const [advanced, setAdvanced] = useState(false);

  // Coming back to change the choices: they're in the address.
  useEffect(() => {
    const search = window.location.search;
    const parsed = parseChoices(search);
    if (!parsed) return;
    setPurpose(parsed.purpose);
    setChosen(Object.fromEntries(chosenKeys(search).map((key) => [key, parsed[key]])));
  }, []);

  const choose = (change: Partial<Choices>) => setChosen((current) => ({ ...current, ...change }));

  return (
    <div className="grid gap-8">
      <LockfileWarning />
      <Question title="What's the site for?">
        {(Object.keys(PURPOSES) as Purpose[]).map((value) => (
          <Choice
            key={value}
            name={`${id}-purpose`}
            value={value}
            current={purpose}
            {...PURPOSES[value]}
            onChange={setPurpose}
          />
        ))}
      </Question>
      {purpose && (
        <Choose
          id={id}
          choices={withDefaults({ ...chosen, purpose })}
          choose={choose}
          advanced={advanced}
          setAdvanced={setAdvanced}
        />
      )}
    </div>
  );
}

function Choose({
  id,
  choices,
  choose,
  advanced,
  setAdvanced,
}: {
  id: string;
  choices: Choices;
  choose: (change: Partial<Choices>) => void;
  advanced: boolean;
  setAdvanced: (open: boolean) => void;
}) {
  const problem = hostProblem(choices);
  const note = gitNote(choices);
  const separate = choices.content === "separate";

  return (
    <>
      <Question title="Start from">
        {(Object.keys(TEMPLATES) as TemplateName[]).map((value) => (
          <Choice
            key={value}
            name={`${id}-template`}
            value={value}
            current={choices.template}
            {...TEMPLATES[value]}
            onChange={(template) => choose({ template })}
          />
        ))}
      </Question>

      <Question title="Where to keep the site's files">
        {(Object.keys(GIT_HOSTS) as GitHostName[]).map((value) => (
          <Choice
            key={value}
            name={`${id}-git`}
            value={value}
            current={choices.git}
            {...GIT_HOSTS[value]}
            badge={value === recommendedGit(choices) ? "Recommended" : undefined}
            // A host chosen before that this git host can't use gives way to the one recommended for it.
            onChange={(git) => choose({ git })}
          />
        ))}
        {note && (
          <Note>
            {note}{" "}
            <button type="button" className={link} onClick={() => choose({ git: "gitlab" })}>
              Use GitLab
            </button>
          </Note>
        )}
      </Question>

      <div className="grid gap-3">
        <p className="text-sm">{advancedSummary(choices)}</p>
        {!advanced && problem && <Note tone="warning">{problem}</Note>}
        <button
          type="button"
          className={`${link} justify-self-start font-medium`}
          aria-expanded={advanced}
          aria-controls={`${id}-advanced`}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? "Hide advanced settings" : "Advanced settings"}
        </button>
      </div>

      {advanced && (
        <div id={`${id}-advanced`} className="grid gap-8">
          <Question title="Blocks">
            {(Object.keys(BLOCK_CHOICES) as BlockChoice[]).map((value) => (
              <Choice
                key={value}
                name={`${id}-blocks`}
                value={value}
                current={choices.blocks}
                {...BLOCK_CHOICES[value]}
                onChange={(blocks) => choose({ blocks })}
              />
            ))}
          </Question>

          <Question title="Who can see the site's files">
            {(Object.keys(VISIBILITIES) as Visibility[]).map((value) => (
              <Choice
                key={value}
                name={`${id}-visibility`}
                value={value}
                current={choices.visibility}
                {...VISIBILITIES[value]}
                onChange={(visibility) => choose({ visibility })}
              />
            ))}
          </Question>

          <Question title="Where to put it online">
            {hostsFor(choices.git).map((value) => (
              <Choice
                key={value}
                name={`${id}-host`}
                value={value}
                current={choices.host}
                label={HOSTS[value].label}
                description={HOSTS[value].note}
                badge={value === recommendedHost(choices) ? "Recommended" : undefined}
                onChange={(host) => choose({ host })}
              />
            ))}
            {problem && <Note tone="warning">{problem}</Note>}
            {choices.host === "vercel" && (
              <Note>
                Once the repository is created, you'll connect it to Vercel, which needs an account there, free for
                non-commercial sites.
              </Note>
            )}
          </Question>

          <Question title="Where to keep the content">
            {(Object.keys(CONTENT_PLACES) as ContentPlace[]).map((value) => (
              <Choice
                key={value}
                name={`${id}-content`}
                value={value}
                current={choices.content}
                {...CONTENT_PLACES[value]}
                onChange={(content) => choose({ content })}
              />
            ))}
            {separate && contentBuildsFor(choices.host).length > 1 && (
              <fieldset className="grid gap-2 pl-6">
                <legend className="mb-1 font-medium">Which one {HOSTS[choices.host].label} builds the site from</legend>
                {contentBuildsFor(choices.host).map((value) => (
                  <Choice
                    key={value}
                    name={`${id}-build`}
                    value={value}
                    current={choices.build}
                    {...CONTENT_BUILDS[value]}
                    onChange={(build) => choose({ build })}
                  />
                ))}
              </fieldset>
            )}
            {separate && (
              <Note>
                Read{" "}
                <SiteLink className={link} href="/docs/content-repository">
                  Content in a repository of its own
                </SiteLink>{" "}
                first: the code's repository is then a developer's, who adds blocks and looks after updates there.
              </Note>
            )}
          </Question>
        </div>
      )}

      <SiteLink className={`${button} justify-self-start`} href={`${CREATE_PATH}?${choicesQuery(choices)}`}>
        Continue
      </SiteLink>
    </>
  );
}
