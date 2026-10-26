import { type ApiOptions, allPages, bitbucketJson } from "./api.js";

/** A schedule that runs one of the repository's custom pipelines. */
export interface Schedule {
  uuid: string;
  enabled: boolean;
  cron_pattern: string;
  target?: { ref_name?: string; selector?: { type?: string; pattern?: string } };
}

/** A pipeline, as Bitbucket lists it. */
export interface Pipeline {
  uuid: string;
  build_number?: number;
  created_on?: string;
  state?: { name?: string; result?: { name?: string } };
}

/** Runs one of the repository's custom pipelines on a branch, with these variables. */
export async function runPipeline(
  api: ApiOptions,
  repo: string,
  branch: string,
  pattern: string,
  variables: Record<string, string> = {},
): Promise<Pipeline> {
  return bitbucketJson<Pipeline>(api, `/repositories/${repo}/pipelines/`, {
    body: {
      target: {
        type: "pipeline_ref_target",
        ref_type: "branch",
        ref_name: branch,
        selector: { type: "custom", pattern },
      },
      variables: Object.entries(variables).map(([key, value]) => ({ key, value, secured: false })),
    },
  });
}

/** The repository's schedules. */
export function schedules(api: ApiOptions, repo: string): Promise<Schedule[]> {
  return allPages<Schedule>(api, `/repositories/${repo}/pipelines_config/schedules?pagelen=100`, 5);
}

/** The schedule that runs a custom pipeline, if there is one. */
export function scheduleFor(found: readonly Schedule[], pattern: string): Schedule | undefined {
  return found.find((schedule) => schedule.target?.selector?.pattern === pattern);
}

/** Where a pipeline's run is shown on Bitbucket. */
export function pipelineUrl(web: string, repo: string, pipeline: Pipeline): string {
  return `${web}/${repo}/pipelines/results/${pipeline.build_number ?? encodeURIComponent(pipeline.uuid)}`;
}
