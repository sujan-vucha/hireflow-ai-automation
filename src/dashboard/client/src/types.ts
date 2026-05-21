export type RunFile = {
  runId: string;
  createdAt: string;
  jobCount: number;
  siteCount: number;
  hasExcel: boolean;
};

export type SiteOption = {
  siteId: string;
  siteName: string;
  baseUrl: string;
  supportsApi: boolean;
};

export type JobRecord = {
  sourceSite: string;
  jobTitle: string;
  company: string;
  agency: string;
  location: string;
  salary: string;
  currency: string;
  jobType: string;
  workType?: string;
  jobFunction: string;
  sector: string;
  subsector: string;
  contractType: string;
  workPattern: string;
  postedDate: string;
  closingDate: string;
  description: string;
  keySkills: string[];
  recruiterName: string;
  recruiterEmail: string;
  recruiterEmailSource: string;
  recruiterEmailPattern: string;
  recruiterPhone: string;
  applyUrl: string;
  jobUrl: string;
  sourceJobId: string;
  siteSpecificFields: Record<string, string>;
  scrapedAt: string;
  matchKeyword: string;
  dateRangeMatched: boolean;
  roleMatchScore: number;
  resumeMatchScore: number;
  matchScoreSource: "keyword" | "ollama" | "none";
  whyStrongFit: string;
  matchGaps: string[];
  applicationStatus: string;
  extractionConfidence: number;
  missingFields: string[];
  originalSearchTitle: string;
  matchedSearchTitle: string;
  aiExpandedTitleUsed: boolean;
  aiProviderUsed: string;
  roleCategory: string;
  semanticRelevanceScore: number;
  semanticMatchType: "EXACT_MATCH" | "STRONG_RELATED_MATCH" | "MEDIUM_RELATED_MATCH" | "WEAK_MATCH" | "NOT_RELEVANT" | "";
  semanticMatchReason: string;
  keyMatchingSkills: string[];
  aiMode: "ollama" | "fallback" | "";
};

export type SiteStatus = {
  siteId: string;
  siteName: string;
  status: string;
  found: number;
  scraped: number;
  afterDateFilter: number;
  duplicatesRemoved: number;
  pagesChecked?: number;
  jobCardsFound?: number;
  detailPagesOpened?: number;
  jobsSaved?: number;
  jobsFilteredByDate?: number;
  jobsFilteredByRelevance?: number;
  reason: string;
  errors: string[];
  warnings: string[];
};

export type CountRow = {
  label: string;
  count: number;
};

export type Analytics = {
  summary: {
    totalJobs: number;
    jobsAfterDateFilter: number;
    jobsAfterRelevanceFilter: number;
    duplicatesRemoved: number;
    missingSalary: number;
    sitesSuccessful: number;
    sitesWithWarnings: number;
    sitesWithNoMatchingJobs: number;
    totalSites: number;
    publicEmails: number;
    missingRecruiter: number;
    missingEmail: number;
    averageMatchScore: number;
    averageExtractionConfidence: number;
    highConfidenceJobs: number;
    errorCount: number;
    warningCount: number;
  };
  statusCounts: CountRow[];
  sourceCounts: CountRow[];
  locationCounts: CountRow[];
  contractCounts: CountRow[];
  recruiterCounts: CountRow[];
  skillCounts: CountRow[];
  postedDateCounts: CountRow[];
  scoreBuckets: CountRow[];
  siteStatus: SiteStatus[];
  aiExpansion: Array<{
    originalTitle: string;
    title: string;
    category: string;
    priority: number;
    reason: string;
    providerUsed: string;
  }>;
  errors: Array<{ siteId: string; siteName: string; message: string }>;
  warnings: Array<{ siteId: string; siteName: string; message: string }>;
};

export type RunPayload = {
  run: RunFile | null;
  jobs: JobRecord[];
  status: unknown[];
  analytics: Analytics;
};

export type DeleteJobsResponse = {
  deletedCount: number;
  payload: RunPayload | null;
};

export type ScrapeState = {
  id: string;
  status: "idle" | "running" | "completed" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  command: string[];
  exitCode?: number | null;
  logs: string[];
  latestRunId?: string;
  error?: string;
};

export type ScrapeForm = {
  mode: "site" | "all";
  site: string;
  title: string;
  location: string;
  days: string;
  maxPages: string;
  maxJobs: string;
  resume: string;
  minMatchScore: string;
  headless: boolean;
  strictKeyword: boolean;
  strictTitle: boolean;
  validateUrls: boolean;
  aiExpand: boolean;
  maxExpandedTitles: string;
  minRelevanceScore: string;
};
