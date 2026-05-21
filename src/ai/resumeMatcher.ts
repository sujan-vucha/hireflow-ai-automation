import type { JobRecord } from "../core/types.js";
import { keywordMatchScore, normalizeText } from "../core/normalize.js";
import { getAIProvider } from "./aiProviderManager.js";

type ResumeMatch = {
  resumeMatchScore: number;
  keyMatchingSkills: string[];
  whyStrongFit: string;
  matchGaps: string[];
};

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function prompt(job: JobRecord, resumeText: string): string {
  return [
    "Score this public job against the candidate resume.",
    "Return only strict JSON. Do not include markdown.",
    "Use only the resume and scraped job text. Do not invent missing facts.",
    "",
    "Required JSON:",
    JSON.stringify(
      {
        resumeMatchScore: 0,
        keyMatchingSkills: ["SEO", "PPC"],
        whyStrongFit: "short evidence-based reason",
        matchGaps: ["missing requirement"]
      },
      null,
      2
    ),
    "",
    "Resume:",
    normalizeText(resumeText).slice(0, 12000),
    "",
    "Job:",
    JSON.stringify(
      {
        title: job.jobTitle,
        description: normalizeText(job.description).slice(0, 7000),
        skills: job.keySkills,
        location: job.location,
        salary: job.salary
      },
      null,
      2
    )
  ].join("\n");
}

function fallback(job: JobRecord): ResumeMatch {
  const score = Math.round(keywordMatchScore(job, job.originalSearchTitle || job.matchKeyword) * 100);
  return {
    resumeMatchScore: score,
    keyMatchingSkills: job.keySkills,
    whyStrongFit: job.whyStrongFit || "Fallback keyword score used because local AI resume matching was unavailable.",
    matchGaps: job.matchGaps || []
  };
}

export async function matchResumeToJobs(
  jobs: JobRecord[],
  resumeText?: string,
  forceFallback = false
): Promise<{ jobs: JobRecord[]; warnings: string[] }> {
  if (!resumeText) return { jobs, warnings: [] };

  const warnings: string[] = [];
  const provider = forceFallback ? null : await getAIProvider();
  const matched: JobRecord[] = [];

  for (const job of jobs) {
    if (provider?.provider) {
      try {
        const parsed = await provider.provider.generateJson<ResumeMatch>(prompt(job, resumeText), {
          temperature: 0.05,
          maxTokens: 700
        });
        matched.push({
          ...job,
          resumeMatchScore: clampScore(parsed.resumeMatchScore),
          keyMatchingSkills: Array.isArray(parsed.keyMatchingSkills) ? parsed.keyMatchingSkills.map(normalizeText).filter(Boolean).slice(0, 12) : [],
          whyStrongFit: normalizeText(parsed.whyStrongFit),
          matchGaps: Array.isArray(parsed.matchGaps) ? parsed.matchGaps.map(normalizeText).filter(Boolean).slice(0, 8) : [],
          matchScoreSource: "ollama"
        });
        continue;
      } catch (error) {
        warnings.push(`${job.jobUrl || job.jobTitle}: Ollama resume match failed; used fallback. ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const fallbackScore = fallback(job);
    matched.push({
      ...job,
      ...fallbackScore,
      matchScoreSource: "keyword"
    });
  }

  return { jobs: matched, warnings };
}
