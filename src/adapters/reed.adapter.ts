import "dotenv/config";
import { pathToFileURL } from "url";
import type { JobRecord, ScrapeInput, ScrapeResult, SiteAdapter } from "../core/types.js";
import { dedupeJobs } from "../core/dedupe.js";
import { isWithinDateRange, parsePostedDate } from "../core/dateParser.js";
import { completeJobRecord, matchesKeyword, stripHtml } from "../core/normalize.js";
import { logger } from "../core/logger.js";

function emptyResult(input: ScrapeInput, overrides: Partial<ScrapeResult>): ScrapeResult {
  return {
    siteId: "reed",
    siteName: "Reed",
    status: "SITE_ERROR",
    targetKeyword: input.title,
    location: input.location,
    days: input.days,
    fromDate: input.fromDate,
    toDate: input.toDate,
    totalFound: 0,
    totalScraped: 0,
    totalAfterDateFilter: 0,
    totalDuplicatesRemoved: 0,
    pagesChecked: 0,
    jobCardsFound: 0,
    detailPagesOpened: 0,
    jobsSaved: 0,
    jobsFilteredByDate: 0,
    jobsFilteredByRelevance: 0,
    jobs: [],
    errors: [],
    warnings: [],
    reason: "",
    ...overrides
  };
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function reedJson(url: string, apiKey: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(apiKey)
    }
  });
  if (!response.ok) throw new Error(`Reed API ${response.status}: ${await response.text()}`);
  return response.json();
}

function mapReedJob(item: any, detail: any, input: ScrapeInput, searchTitle: string): JobRecord {
  const postedDate = parsePostedDate(
    detail?.datePosted ||
      detail?.postedDate ||
      detail?.date ||
      item.datePosted ||
      item.postedDate ||
      item.date
  );
  const description = stripHtml(detail?.jobDescription || item.jobDescription || "");
  const salary = [item.minimumSalary, item.maximumSalary].filter(Boolean).join(" - ");
  const jobUrl = detail?.jobUrl || item.jobUrl || `https://www.reed.co.uk/jobs/${item.jobId}`;

  return completeJobRecord(
    {
      sourceJobId: String(item.jobId || ""),
      jobUrl,
      applyUrl: detail?.externalUrl || jobUrl,
      jobTitle: item.jobTitle || detail?.jobTitle || "",
      company: item.employerName || "",
      agency: item.employerName || "Reed",
      location: item.locationName || "",
      salary,
      currency: item.currency || "",
      jobType: detail?.jobType || item.jobType || "",
      contractType: detail?.contractType || item.contractType || "",
      workPattern: detail?.workPattern || "",
      postedDate,
      closingDate: parsePostedDate(detail?.expirationDate || item.expirationDate || ""),
      description,
      originalSearchTitle: input.originalTitle || input.title,
      matchedSearchTitle: searchTitle,
      aiExpandedTitleUsed: searchTitle.toLowerCase() !== (input.originalTitle || input.title).toLowerCase(),
      aiProviderUsed: input.aiProvider || "ollama",
      aiMode: input.aiProvider || "ollama"
    },
    {
      sourceSite: "Reed",
      agency: item.employerName || "Reed",
      matchKeyword: input.title,
      dateRangeMatched: isWithinDateRange(postedDate, input.fromDate, input.toDate)
    }
  );
}

export const reedAdapter: SiteAdapter = {
  siteId: "reed",
  siteName: "Reed",
  baseUrl: "https://www.reed.co.uk",
  supportsApi: true,

  buildSearchUrl(input: ScrapeInput, searchTitle = input.title, page = 1): string {
    const url = new URL("https://www.reed.co.uk/api/1.0/search");
    url.searchParams.set("keywords", searchTitle);
    url.searchParams.set("locationName", input.location);
    url.searchParams.set("postedByRecruitmentAgency", "true");
    url.searchParams.set("resultsToTake", "100");
    url.searchParams.set("resultsToSkip", String((Math.max(1, page) - 1) * 100));
    return url.toString();
  },

  async scrape(input: ScrapeInput): Promise<ScrapeResult> {
    const apiKey = process.env.REED_API_KEY;
    if (!apiKey || apiKey === "your_reed_api_key_here") {
      return emptyResult(input, {
        status: "API_KEY_MISSING",
        reason: "REED_API_KEY is missing. Reed was skipped without stopping the full scraper."
      });
    }

    const jobs: JobRecord[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    let totalFound = 0;
    let pagesChecked = 0;
    let detailPagesOpened = 0;
    let jobsBeforeDateFilter = 0;
    const take = 100;
    const searchTerms = input.expandedTitles?.length ? input.expandedTitles : [input.title];

    try {
      for (const searchTitle of searchTerms) {
        if (input.maxJobs && jobs.length >= input.maxJobs) break;
        for (let skip = 0; ; skip += take) {
          if (input.maxJobs && jobs.length >= input.maxJobs) break;
          const page = skip / take + 1;
          const url = this.buildSearchUrl(input, searchTitle, page);
          logger.site("Reed", `API page ${page} for "${searchTitle}": ${url}`);

          const data = await reedJson(url, apiKey);
          pagesChecked += 1;
          const results = data.results || [];
          totalFound += Number(data.totalResults || results.length || 0);
          logger.site("Reed", `Job cards found on API page: ${results.length}`);
          if (results.length === 0) break;

          for (const item of results) {
            if (input.maxJobs && jobs.length >= input.maxJobs) break;
            let detail: any = null;
            try {
              detail = await reedJson(`https://www.reed.co.uk/api/1.0/jobs/${item.jobId}`, apiKey);
              detailPagesOpened += 1;
            } catch (error: any) {
              errors.push(`Reed detail failed for ${item.jobId}: ${error?.message || error}`);
            }

            jobsBeforeDateFilter += 1;
            const job = mapReedJob(item, detail, input, searchTitle);
            if (!job.postedDate) {
              warnings.push(`${job.jobUrl}: posted date not publicly available or not parseable.`);
              continue;
            }
            if (!isWithinDateRange(job.postedDate, input.fromDate, input.toDate)) continue;
            if (!matchesKeyword(job, searchTitle)) continue;
            jobs.push(job);
          }

          if (results.length < take) break;
          if (input.maxPages && page >= input.maxPages) break;
        }
      }

      const deduped = dedupeJobs(jobs);
      return emptyResult(input, {
        status: deduped.jobs.length > 0 ? (errors.length ? "PARTIAL_SUCCESS" : "SUCCESS") : "NO_MATCHING_JOBS",
        totalFound,
        totalAfterDateFilter: jobs.length,
        totalScraped: deduped.jobs.length,
        totalDuplicatesRemoved: deduped.duplicatesRemoved,
        pagesChecked,
        jobCardsFound: jobsBeforeDateFilter,
        detailPagesOpened,
        jobsSaved: deduped.jobs.length,
        jobsFilteredByDate: Math.max(0, jobsBeforeDateFilter - jobs.length),
        jobs: deduped.jobs,
        errors,
        warnings,
        reason:
          deduped.jobs.length > 0
            ? "Reed official API scrape completed."
            : "No Reed API jobs matched the keyword and selected date range."
      });
    } catch (error: any) {
      return emptyResult(input, {
        status: jobs.length ? "PARTIAL_SUCCESS" : "SITE_ERROR",
        totalFound,
        totalAfterDateFilter: jobs.length,
        totalScraped: jobs.length,
        pagesChecked,
        jobCardsFound: jobsBeforeDateFilter,
        detailPagesOpened,
        jobsSaved: jobs.length,
        jobs,
        errors: [...errors, error?.message || "Unknown Reed API failure"],
        warnings,
        reason: "Reed API scrape failed."
      });
    }
  }
};

async function runStandalone() {
  const days = Number(process.env.REED_DAYS || 7);
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = await reedAdapter.scrape({
    site: "reed",
    title: process.env.REED_KEYWORDS || "Digital Marketing Consultant",
    location: process.env.REED_LOCATION || "United Kingdom",
    days,
    fromDate,
    toDate,
    headless: true
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
