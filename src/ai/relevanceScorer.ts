import type { JobRecord, ScrapeInput } from "../core/types.js";
import { keywordMatchScore, normalizeText, titleMatchScore } from "../core/normalize.js";
import { getAIProvider } from "./aiProviderManager.js";

type SemanticMatchType = JobRecord["semanticMatchType"];

type RelevanceScore = {
  relevanceScore: number;
  matchType: SemanticMatchType;
  roleCategory: string;
  reason: string;
  shouldKeep: boolean;
  keyMatchingSkills?: string[];
};

type RelevanceResult = {
  jobs: JobRecord[];
  providerUsed: "ollama" | "fallback";
  ollamaAvailable: boolean;
  fallbackAIUsed: boolean;
  jobsBeforeAIScoring: number;
  jobsAfterAIScoring: number;
  rejectedAsNotRelevant: number;
  warnings: string[];
};

const rejectPattern =
  /\b(warehouse|admin assistant|administrator|call centre|customer service|retail assistant|field sales|door to door|finance manager|financial controller|accountant|solicitor|lawyer|engineer|technician|social worker|maintenance officer)\b/i;

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function roleCategory(job: JobRecord): string {
  const text = normalizeText(`${job.jobTitle} ${job.jobFunction} ${job.description}`).toLowerCase();
  if (/\bppc|paid search\b/.test(text)) return "PPC";
  if (/\bpaid media|paid social|performance marketing\b/.test(text)) return "Paid Media";
  if (/\bseo\b/.test(text)) return "SEO";
  if (/\bgrowth|acquisition|demand generation\b/.test(text)) return "Growth";
  if (/\bcrm|lifecycle|email marketing|marketing automation\b/.test(text)) return "CRM";
  if (/\banalytics|google analytics|reporting\b/.test(text)) return "Analytics";
  if (/\bcontent\b/.test(text)) return "Content";
  if (/\bsocial media\b/.test(text)) return "Social Media";
  if (/\becommerce|e-commerce\b/.test(text)) return "Ecommerce";
  if (/\bmarketing|digital campaign|digital marketing\b/.test(text)) return "General Digital Marketing";
  return "Other";
}

function fallbackScore(job: JobRecord, originalTitle: string): RelevanceScore {
  const titleScore = Math.round(titleMatchScore(job, originalTitle) * 100);
  const keywordScore = Math.round(keywordMatchScore(job, originalTitle) * 100);
  const matchedSearchScore = Math.round(titleMatchScore(job, job.matchedSearchTitle || originalTitle) * 100);
  const category = roleCategory(job);
  const isRejected = rejectPattern.test(`${job.jobTitle} ${job.description}`) || category === "Other";
  const relevanceScore = isRejected ? Math.min(45, Math.max(titleScore, keywordScore)) : Math.max(titleScore, keywordScore, matchedSearchScore);
  const matchType: SemanticMatchType =
    relevanceScore >= 90
      ? "EXACT_MATCH"
      : relevanceScore >= 75
        ? "STRONG_RELATED_MATCH"
        : relevanceScore >= 60
          ? "MEDIUM_RELATED_MATCH"
          : relevanceScore >= 45
            ? "WEAK_MATCH"
            : "NOT_RELEVANT";

  return {
    relevanceScore,
    matchType,
    roleCategory: category,
    reason: isRejected
      ? "Rejected by local rules because the role appears outside the requested marketing intent."
      : "Scored by local keyword/title overlap against the original search intent.",
    shouldKeep: !isRejected && relevanceScore >= 45,
    keyMatchingSkills: job.keySkills
  };
}

function relevancePrompt(job: JobRecord, originalTitle: string): string {
  return [
    "Score this scraped public job against the original recruitment search intent.",
    "Return only strict JSON. Do not include markdown.",
    "",
    "Rules:",
    "- Use only the scraped job data below.",
    "- Do not hallucinate missing information.",
    "- Keep exact matches and strong related marketing roles.",
    "- Reject unrelated sales, call centre, warehouse, admin, finance, engineering, retail, and non-marketing roles.",
    "- If the title is different but the description strongly matches the intent, keep it.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        relevanceScore: 0,
        matchType: "EXACT_MATCH | STRONG_RELATED_MATCH | MEDIUM_RELATED_MATCH | WEAK_MATCH | NOT_RELEVANT",
        roleCategory:
          "Paid Media | SEO | PPC | Growth | CRM | Analytics | Content | Social Media | Ecommerce | General Digital Marketing | Other",
        reason: "short explanation",
        shouldKeep: true,
        keyMatchingSkills: ["SEO", "PPC"]
      },
      null,
      2
    ),
    "",
    `Original user title: ${originalTitle}`,
    `Matched search title: ${job.matchedSearchTitle}`,
    "Scraped job:",
    JSON.stringify(
      {
        title: job.jobTitle,
        description: normalizeText(job.description).slice(0, 5000),
        skills: job.keySkills,
        location: job.location,
        salary: job.salary,
        agency: job.agency,
        source: job.sourceSite
      },
      null,
      2
    )
  ].join("\n");
}

function applyScore(job: JobRecord, score: RelevanceScore, aiMode: "ollama" | "fallback", providerUsed: string): JobRecord {
  return {
    ...job,
    semanticRelevanceScore: clampScore(score.relevanceScore),
    semanticMatchType: score.matchType || "NOT_RELEVANT",
    roleCategory: normalizeText(score.roleCategory) || "Other",
    semanticMatchReason: normalizeText(score.reason),
    keyMatchingSkills: Array.isArray(score.keyMatchingSkills) ? score.keyMatchingSkills.map(normalizeText).filter(Boolean).slice(0, 12) : [],
    aiProviderUsed: providerUsed,
    aiMode
  };
}

export async function scoreSemanticRelevance(jobs: JobRecord[], input: ScrapeInput): Promise<RelevanceResult> {
  const originalTitle = input.originalTitle || input.title;
  const minScore = input.minRelevanceScore ?? 70;
  const warnings: string[] = [];
  const providerStatus =
    input.aiProvider === "fallback"
      ? { provider: null, providerUsed: "fallback" as const, ollamaAvailable: false, fallbackAIUsed: true }
      : await getAIProvider();
  const scored: JobRecord[] = [];

  for (const job of jobs) {
    if (providerStatus.provider) {
      try {
        const aiScore = await providerStatus.provider.generateJson<RelevanceScore>(relevancePrompt(job, originalTitle), {
          temperature: 0.05,
          maxTokens: 700
        });
        scored.push(applyScore(job, aiScore, "ollama", "ollama"));
        continue;
      } catch (error) {
        warnings.push(`${job.jobUrl || job.jobTitle}: Ollama relevance failed; used fallback scoring. ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    scored.push(applyScore(job, fallbackScore(job, originalTitle), "fallback", "fallback"));
  }

  const kept = scored.filter((job) => {
    if (job.semanticMatchType === "NOT_RELEVANT") return false;
    return (job.semanticRelevanceScore || 0) >= minScore;
  });

  return {
    jobs: kept,
    providerUsed: providerStatus.providerUsed,
    ollamaAvailable: providerStatus.ollamaAvailable,
    fallbackAIUsed: providerStatus.fallbackAIUsed || warnings.length > 0,
    jobsBeforeAIScoring: jobs.length,
    jobsAfterAIScoring: kept.length,
    rejectedAsNotRelevant: jobs.length - kept.length,
    warnings
  };
}
