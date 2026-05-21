import type { JobRecord } from "./types.js";
import { normalizeText } from "./normalize.js";

function dedupeKey(job: JobRecord): string {
  if (job.sourceJobId) return `id:${job.sourceSite}:${job.sourceJobId}`.toLowerCase();
  if (job.jobUrl) return `url:${job.jobUrl}`.toLowerCase();

  return [
    job.jobTitle,
    job.company,
    job.location,
    job.postedDate
  ]
    .map((part) => normalizeText(part).toLowerCase())
    .join("|");
}

export function dedupeJobs(jobs: JobRecord[]): { jobs: JobRecord[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const deduped: JobRecord[] = [];

  for (const job of jobs) {
    const key = dedupeKey(job);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(job);
  }

  return {
    jobs: deduped,
    duplicatesRemoved: jobs.length - deduped.length
  };
}

