import type { JobRecord, ScrapeInput } from "./types.js";
import { keywordMatchScore } from "./normalize.js";

type ScoreResult = {
  jobs: JobRecord[];
  warnings: string[];
};

function fallbackScore(job: JobRecord): JobRecord {
  const score = Math.round(keywordMatchScore(job, job.matchKeyword) * 100);
  return {
    ...job,
    roleMatchScore: score,
    resumeMatchScore: job.resumeMatchScore || score,
    matchScoreSource: job.matchScoreSource === "ollama" ? "ollama" : "keyword",
    whyStrongFit:
      job.whyStrongFit ||
      (score >= 80
        ? "Strong role/title and description overlap with the target keywords."
        : "Matched the configured public keyword, location, and date filters."),
    matchGaps: job.matchGaps || []
  };
}

export async function scoreJobsWithLlm(jobs: JobRecord[], _input: ScrapeInput, _resumeText?: string): Promise<ScoreResult> {
  return {
    jobs: jobs.map(fallbackScore),
    warnings: []
  };
}
