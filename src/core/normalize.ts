import type { JobRecord } from "./types.js";

export const NOT_PUBLICLY_AVAILABLE = "Not publicly available";

export function normalizeText(text?: string | null): string {
  if (text === undefined || text === null) return "";
  return String(text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function stripHtml(html?: string | null): string {
  return normalizeText((html || "").replace(/<[^>]*>/g, " "));
}

export function absoluteUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return "";
  }
}

export function slugify(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function extractEmail(text: string): string {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

export function extractPhone(text: string): string {
  return text.match(/(?:\+44|0)\s?\d{2,5}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/)?.[0] || "";
}

export function extractCurrency(text: string): string {
  if (/£|gbp|pound/i.test(text)) return "GBP";
  if (/€|eur|euro/i.test(text)) return "EUR";
  if (/\$|usd/i.test(text)) return "USD";
  return "";
}

export function extractSalary(text: string): string {
  const clean = normalizeText(text);
  return (
    clean.match(/£\s?\d[\d,.]*(?:\s?[-–]\s?£?\s?\d[\d,.]*)?(?:\s?(?:per|a)\s?(?:day|hour|annum|year|month))?/i)?.[0] ||
    clean.match(/\b\d{2,3}k\s?[-–]\s?\d{2,3}k\b/i)?.[0] ||
    ""
  );
}

export function extractKeySkills(description: string): string[] {
  const skills = [
    "SEO",
    "PPC",
    "SEM",
    "CRM",
    "Google Analytics",
    "Paid Social",
    "Content Marketing",
    "Email Marketing",
    "Marketing Automation",
    "HubSpot",
    "Salesforce",
    "React",
    "Node.js",
    "TypeScript",
    "Python",
    "SQL",
    "AWS",
    "Azure",
    "Project Management"
  ];
  const text = description.toLowerCase();
  return skills.filter((skill) => text.includes(skill.toLowerCase()));
}

const keywordStopWords = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "into",
  "role",
  "jobs",
  "job",
  "position",
  "positions",
  "vacancy",
  "vacancies"
]);

const genericRoleTokens = new Set([
  "advisor",
  "adviser",
  "analyst",
  "associate",
  "consultant",
  "director",
  "executive",
  "head",
  "lead",
  "manager",
  "officer",
  "planner",
  "specialist"
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i").test(haystack);
}

function keywordTokens(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[/|,;]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9+#.-]/g, ""))
    .filter((token) => token.length > 2 && !keywordStopWords.has(token));
}

export function keywordAlternatives(keyword: string): string[] {
  const cleaned = normalizeText(keyword);
  if (!cleaned) return [];

  const alternatives = cleaned
    .split(/\s*(?:\/|\||;|\bor\b)\s*/i)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  return alternatives.length ? alternatives : [cleaned];
}

function expandedKeywordAlternatives(keyword: string): string[] {
  const alternatives = keywordAlternatives(keyword);
  const expanded = new Set<string>(alternatives);

  for (const alternative of alternatives) {
    const lower = alternative.toLowerCase();
    const tokens = keywordTokens(alternative);

    if (tokens.length > 1) {
      expanded.add(tokens.join(" "));
    }
    if (lower.includes("digital marketing")) {
      expanded.add("digital marketing");
      expanded.add("marketing consultant");
      expanded.add("marketing manager");
    }
    if (lower.includes("growth strategy")) {
      expanded.add("growth marketing");
      expanded.add("growth strategy");
      expanded.add("growth");
    }
    if (lower.includes("performance media")) {
      expanded.add("performance marketing");
      expanded.add("paid media");
      expanded.add("paid social");
      expanded.add("ppc");
    }
    if (lower.includes("analytics")) {
      expanded.add("marketing analytics");
      expanded.add("digital analytics");
      expanded.add("google analytics");
      expanded.add("analytics");
    }
  }

  return [...expanded].map((item) => normalizeText(item)).filter(Boolean);
}

export function searchKeywordAlternatives(keyword: string): string[] {
  const alternatives = expandedKeywordAlternatives(keyword);
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const alternative of alternatives.length ? alternatives : [normalizeText(keyword)]) {
    const normalized = normalizeText(alternative);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

export function keywordMatchScore(job: Partial<JobRecord>, keyword: string): number {
  const alternatives = expandedKeywordAlternatives(keyword);
  if (alternatives.length === 0) return 1;

  const haystack = normalizeText(
    [
      job.jobTitle,
      job.jobFunction,
      job.sector,
      job.subsector,
      job.contractType,
      job.workPattern,
      job.description,
      ...(job.keySkills || [])
    ].join(" ")
  ).toLowerCase();

  if (!haystack) return 0;

  let bestScore = 0;
  for (const alternative of alternatives) {
    const normalizedAlternative = normalizeText(alternative).toLowerCase();
    if (!normalizedAlternative) continue;
    if (haystack.includes(normalizedAlternative)) {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    const tokens = keywordTokens(alternative);
    if (tokens.length === 0) continue;

    const matchedTokens = tokens.filter((token) => containsTerm(haystack, token));
    const matched = matchedTokens.length;
    const domainTokens = tokens.filter((token) => !genericRoleTokens.has(token));
    const domainMatched = domainTokens.filter((token) => containsTerm(haystack, token)).length;

    if (domainTokens.length > 0 && domainMatched === 0) {
      continue;
    }

    if (tokens.length === 1) {
      bestScore = Math.max(bestScore, matched ? 0.85 : 0);
      continue;
    }

    let score = matched / tokens.length;
    const titleBoost = matched >= 2 && normalizeText(job.jobTitle || "").toLowerCase().split(/\s+/).some((part) =>
      tokens.includes(part.replace(/[^a-z0-9+#.-]/g, ""))
    )
      ? 0.1
      : 0;
    score = Math.min(1, score + titleBoost);
    if (domainTokens.length >= 2 && domainMatched < 2) {
      score = Math.min(score, 0.5);
    }
    bestScore = Math.max(bestScore, score);
  }

  return Number(bestScore.toFixed(2));
}

export function titleMatchScore(job: Partial<JobRecord>, keyword: string): number {
  const title = normalizeText(job.jobTitle || "").toLowerCase();
  if (!title) return 0;

  const alternatives = expandedKeywordAlternatives(keyword);
  if (alternatives.length === 0) return 1;

  let bestScore = 0;
  for (const alternative of alternatives) {
    const normalizedAlternative = normalizeText(alternative).toLowerCase();
    if (!normalizedAlternative) continue;
    if (title.includes(normalizedAlternative)) {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    const tokens = keywordTokens(alternative);
    const domainTokens = tokens.filter((token) => !genericRoleTokens.has(token));
    if (domainTokens.length === 0) continue;

    const matchedTokens = tokens.filter((token) => containsTerm(title, token));
    const domainMatched = domainTokens.filter((token) => containsTerm(title, token));
    if (domainMatched.length === 0) continue;

    const roleTokens = tokens.filter((token) => genericRoleTokens.has(token));
    const roleMatched =
      roleTokens.some((token) => containsTerm(title, token)) ||
      [...genericRoleTokens].some((token) => containsTerm(title, token));

    if (domainTokens.length === 1) {
      const domainToken = domainTokens[0];
      const needsMarketingContext = ["analytics", "data"].includes(domainToken);
      const hasMarketingContext =
        !needsMarketingContext ||
        ["marketing", "digital", "growth", "performance", "media", "crm"].some((token) =>
          containsTerm(title, token)
        );
      if (hasMarketingContext && roleMatched) bestScore = Math.max(bestScore, 0.75);
      if (matchedTokens.length >= 2 && hasMarketingContext) bestScore = Math.max(bestScore, 0.85);
      continue;
    }

    const ratio = domainMatched.length / domainTokens.length;
    if (domainMatched.length === domainTokens.length) {
      bestScore = Math.max(bestScore, roleMatched ? 0.95 : 0.9);
    } else if (domainMatched.length >= 2 && ratio >= 0.66) {
      bestScore = Math.max(bestScore, 0.85);
    }
  }

  return Number(bestScore.toFixed(2));
}

export function matchesKeyword(job: Partial<JobRecord>, keyword: string): boolean {
  const alternatives = keywordAlternatives(keyword);
  if (alternatives.length === 0) return true;
  return keywordMatchScore(job, keyword) >= 0.6;
}

export function matchesStrictTitle(job: Partial<JobRecord>, keyword: string): boolean {
  const alternatives = keywordAlternatives(keyword);
  if (alternatives.length === 0) return true;
  return titleMatchScore(job, keyword) >= 0.75;
}

export function matchesLocation(job: Partial<JobRecord>, location: string): boolean {
  const needle = normalizeText(location).toLowerCase();
  if (!needle) return true;
  if (/^(uk|united kingdom|great britain|britain|england|scotland|wales|northern ireland)$/.test(needle)) {
    return true;
  }

  const haystack = normalizeText(`${job.location || ""} ${job.description || ""}`).toLowerCase();
  if (!haystack) return true;
  if (haystack.includes(needle)) return true;

  const tokens = needle
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["and", "the", "for", "with"].includes(token));
  if (tokens.length === 0) return true;
  return tokens.every((token) => haystack.includes(token));
}

export function findMissingFields(job: Partial<JobRecord>): string[] {
  const fields: Array<keyof JobRecord> = [
    "jobTitle",
    "company",
    "location",
    "salary",
    "postedDate",
    "description",
    "recruiterName",
    "recruiterEmail",
    "recruiterPhone",
    "jobUrl"
  ];

  return fields.filter((field) => {
    const value = job[field];
    return !value || value === NOT_PUBLICLY_AVAILABLE || (Array.isArray(value) && value.length === 0);
  });
}

export function confidenceFromMissing(missingFields: string[]): number {
  const score = Math.max(35, 100 - missingFields.length * 7);
  return Number((score / 100).toFixed(2));
}

export function refreshJobQuality(job: JobRecord): JobRecord {
  const missingFields = findMissingFields(job);
  return {
    ...job,
    missingFields,
    extractionConfidence: confidenceFromMissing(missingFields)
  };
}

export function completeJobRecord(
  partial: Partial<JobRecord>,
  defaults: {
    sourceSite: string;
    agency: string;
    matchKeyword: string;
    dateRangeMatched: boolean;
  }
): JobRecord {
  const job: Partial<JobRecord> = {
    sourceSite: defaults.sourceSite,
    agency: defaults.agency,
    company: "",
    currency: extractCurrency(`${partial.salary || ""} ${partial.description || ""}`),
    jobFunction: "",
    sector: "",
    subsector: "",
    keySkills: extractKeySkills(partial.description || ""),
    recruiterName: partial.recruiterName || NOT_PUBLICLY_AVAILABLE,
    recruiterEmail: partial.recruiterEmail || NOT_PUBLICLY_AVAILABLE,
    recruiterEmailSource:
      partial.recruiterEmailSource ||
      (partial.recruiterEmail ? "public_page" : "not_publicly_available"),
    recruiterEmailPattern: partial.recruiterEmailPattern || "",
    recruiterPhone: partial.recruiterPhone || NOT_PUBLICLY_AVAILABLE,
    siteSpecificFields: partial.siteSpecificFields || {},
    scrapedAt: new Date().toISOString(),
    matchKeyword: defaults.matchKeyword,
    dateRangeMatched: defaults.dateRangeMatched,
    roleMatchScore: 0,
    resumeMatchScore: 0,
    matchScoreSource: "none",
    whyStrongFit: "",
    matchGaps: [],
    applicationStatus: "Pending",
    originalSearchTitle: defaults.matchKeyword,
    matchedSearchTitle: defaults.matchKeyword,
    aiExpandedTitleUsed: false,
    aiProviderUsed: "",
    roleCategory: "",
    semanticRelevanceScore: 0,
    semanticMatchType: "",
    semanticMatchReason: "",
    keyMatchingSkills: [],
    aiMode: "",
    ...partial
  };

  const missingFields = findMissingFields(job);

  return {
    sourceSite: job.sourceSite || defaults.sourceSite,
    jobTitle: job.jobTitle || "",
    company: job.company || "",
    agency: job.agency || defaults.agency,
    location: job.location || "",
    salary: job.salary || "",
    currency: job.currency || "",
    jobType: job.jobType || "",
    jobFunction: job.jobFunction || "",
    sector: job.sector || "",
    subsector: job.subsector || "",
    contractType: job.contractType || "",
    workPattern: job.workPattern || "",
    postedDate: job.postedDate || "",
    closingDate: job.closingDate || "",
    description: job.description || "",
    keySkills: job.keySkills || [],
    recruiterName: job.recruiterName || NOT_PUBLICLY_AVAILABLE,
    recruiterEmail: job.recruiterEmail || NOT_PUBLICLY_AVAILABLE,
    recruiterEmailSource: job.recruiterEmailSource || "not_publicly_available",
    recruiterEmailPattern: job.recruiterEmailPattern || "",
    recruiterPhone: job.recruiterPhone || NOT_PUBLICLY_AVAILABLE,
    applyUrl: job.applyUrl || job.jobUrl || "",
    jobUrl: job.jobUrl || "",
    sourceJobId: job.sourceJobId || "",
    siteSpecificFields: job.siteSpecificFields || {},
    scrapedAt: job.scrapedAt || new Date().toISOString(),
    matchKeyword: job.matchKeyword || defaults.matchKeyword,
    dateRangeMatched: Boolean(job.dateRangeMatched),
    roleMatchScore: job.roleMatchScore || 0,
    resumeMatchScore: job.resumeMatchScore || 0,
    matchScoreSource: job.matchScoreSource || "none",
    whyStrongFit: job.whyStrongFit || "",
    matchGaps: job.matchGaps || [],
    applicationStatus: job.applicationStatus || "Pending",
    extractionConfidence: job.extractionConfidence || confidenceFromMissing(missingFields),
    missingFields,
    originalSearchTitle: job.originalSearchTitle || defaults.matchKeyword,
    matchedSearchTitle: job.matchedSearchTitle || defaults.matchKeyword,
    aiExpandedTitleUsed: Boolean(job.aiExpandedTitleUsed),
    aiProviderUsed: job.aiProviderUsed || "",
    roleCategory: job.roleCategory || "",
    semanticRelevanceScore: job.semanticRelevanceScore || 0,
    semanticMatchType: job.semanticMatchType || "",
    semanticMatchReason: job.semanticMatchReason || "",
    keyMatchingSkills: job.keyMatchingSkills || [],
    aiMode: job.aiMode || ""
  };
}
