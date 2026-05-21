import * as cheerio from "cheerio";
import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";
import type { JobRecord, ScrapeInput } from "../core/types.js";
import { extractJobFromHtml, type ListingHint } from "../core/jobExtractor.js";
import { extractSalary, normalizeText, refreshJobQuality } from "../core/normalize.js";

function postedWindow(days: number): string {
  if (days <= 0) return "0";
  if (days <= 1) return "1";
  if (days <= 3) return "3";
  if (days <= 7) return "7";
  if (days <= 14) return "14";
  if (days <= 28) return "28";
  return "";
}

function isUnitedKingdom(location: string): boolean {
  return /^(uk|united kingdom|great britain|britain)$/i.test(location.trim());
}

function searchParams(input: ScrapeInput): Record<string, string> {
  const posted = postedWindow(input.days);
  const params: Record<string, string> = {
    q: input.title,
    order: "date",
    perpage: "100",
    us: "1"
  };

  if (posted) params.posted = posted;
  if (input.location && !isUnitedKingdom(input.location)) {
    params.geo = input.location;
    params.distance = "35";
  } else if (input.location) {
    params.geo = input.location;
    params.distance = "750";
  }

  return params;
}

function firstMatch(text: string, pattern: RegExp): string {
  return normalizeText(text.match(pattern)?.[1] || "");
}

function extractCvLibraryJob(params: {
  html: string;
  pageUrl: string;
  sourceSite: string;
  agency: string;
  matchKeyword: string;
  dateRangeMatched: boolean;
  listingHint?: ListingHint;
}): JobRecord {
  const job = extractJobFromHtml(params);
  const $ = cheerio.load(params.html);
  $("script, style, noscript, svg").remove();
  const bodyText = normalizeText($("body").text());
  const jobId = normalizeText(params.pageUrl.match(/\/job\/(\d{5,})\//)?.[1] || job.sourceJobId);
  const advertiser =
    firstMatch(bodyText, /Posted\s+(?:just now|\d+\s+\w+\s+ago|today|yesterday|on\s+[^ ]+)\s+by\s+(.+?)\s+Location:/i) ||
    firstMatch(bodyText, /Posted\s+.+?\s+by\s+(.+?)\s+Salary\/Rate:/i);
  const salaryRate = firstMatch(bodyText, /Salary\/Rate:\s*(.+?)\s+Apply Now/i) || extractSalary(bodyText);
  const jobType = firstMatch(bodyText, /Job Type:\s*(.+?)\s+(?:We're|We are|Are you|An exciting|A leading|My client|Our client|About|Apply Now)/i);

  return refreshJobQuality({
    ...job,
    sourceJobId: jobId,
    company: job.company || advertiser,
    salary: job.salary || salaryRate,
    contractType: job.contractType || jobType,
    siteSpecificFields: {
      ...job.siteSpecificFields,
      cvLibraryJobId: jobId,
      cvLibraryAdvertiser: advertiser,
      cvLibrarySalaryRate: salaryRate,
      cvLibraryJobType: jobType
    }
  });
}

export const cvLibraryAdapter = createGenericAdapter({
  siteId: "cvlibrary",
  siteName: "CV-Library",
  baseUrl: "https://www.cv-library.co.uk",
  crawlMode: "playwright",
  detailMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.cv-library.co.uk/search-jobs", searchParams(input));
  },
  extractJob: extractCvLibraryJob
});
