export type AccessStatus =
  | "ALLOWED"
  | "CAPTCHA_OR_VERIFICATION_PAGE"
  | "LOGIN_REQUIRED"
  | "ACCESS_RESTRICTED";

export type SiteRunStatus =
  | "SUCCESS"
  | "SUCCESS_WITH_WARNINGS"
  | "NO_MATCHING_JOBS"
  | "LOW_INVENTORY"
  | "ALL_AVAILABLE_SCRAPED"
  | "PUBLIC_PAGE_FALLBACK"
  | "ACCESS_RESTRICTED"
  | "CAPTCHA_OR_VERIFICATION_PAGE"
  | "LOGIN_REQUIRED"
  | "API_KEY_MISSING"
  | "SITE_ERROR"
  | "SELECTOR_FAILURE"
  | "PARTIAL_SUCCESS";

export type ScrapeInput = {
  site?: string;
  all?: boolean;
  title: string;
  location: string;
  days: number;
  fromDate: string;
  toDate: string;
  headless: boolean;
  maxPages?: number;
  maxJobs?: number;
  output?: "excel" | "json" | "both";
  resume?: string;
  llm?: "none" | "ollama";
  minMatchScore?: number;
  strictKeyword?: boolean;
  strictTitle?: boolean;
  validateUrls?: boolean;
  scraperProvider?: "local" | "apify";
  aiExpand?: boolean;
  maxExpandedTitles?: number;
  minRelevanceScore?: number;
  aiProvider?: "ollama" | "fallback";
  expandedTitles?: string[];
  originalTitle?: string;
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

export type ScrapeResult = {
  siteId: string;
  siteName: string;
  status: SiteRunStatus;
  targetKeyword: string;
  location: string;
  days: number;
  fromDate: string;
  toDate: string;
  totalFound: number;
  totalScraped: number;
  totalAfterDateFilter: number;
  totalDuplicatesRemoved: number;
  pagesChecked?: number;
  jobCardsFound?: number;
  detailPagesOpened?: number;
  jobsSaved?: number;
  jobsFilteredByDate?: number;
  jobsFilteredByRelevance?: number;
  jobs: JobRecord[];
  errors: string[];
  warnings: string[];
  reason: string;
  aiExpansionUsed?: boolean;
  aiProviderUsed?: string;
  expandedTitlesCount?: number;
  expandedTitles?: string[];
  jobsBeforeAIScoring?: number;
  jobsAfterAIScoring?: number;
  rejectedAsNotRelevant?: number;
  fallbackAIUsed?: boolean;
  ollamaAvailable?: boolean;
};

export type ExpandedTitle = {
  title: string;
  category: string;
  priority: number;
  reason: string;
};

export type TitleExpansionReport = {
  originalTitle: string;
  expandedTitles: ExpandedTitle[];
  negativeTitles: string[];
  providerUsed: "ollama" | "fallback";
  fallbackAIUsed: boolean;
  ollamaAvailable: boolean;
};

export interface SiteAdapter {
  siteId: string;
  siteName: string;
  baseUrl: string;
  supportsApi: boolean;
  buildSearchUrl(input: ScrapeInput, searchTitle: string, page: number): string;
  scrape(input: ScrapeInput): Promise<ScrapeResult>;
}

export type AccessDecision = {
  allowed: boolean;
  status: AccessStatus;
  reason?: string;
};
