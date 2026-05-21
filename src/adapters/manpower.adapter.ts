import * as cheerio from "cheerio";
import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";
import type { JobRecord } from "../core/types.js";
import { extractJobFromHtml, type ListingHint } from "../core/jobExtractor.js";
import { normalizeText, refreshJobQuality } from "../core/normalize.js";

function labeledValue(text: string, label: string): string {
  const pattern = new RegExp(`${label}:\\s*(.+?)(?=\\s+[A-Z][a-zA-Z ]+:|$)`, "i");
  return normalizeText(text.match(pattern)?.[1] || "");
}

function extractManpowerJob(params: {
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
  const detailText = normalizeText($(".job-details").first().text() || $("body").text());
  const sideLocation = normalizeText($(".location-sidebar").first().text().replace(/^Location/i, ""));
  const jobType = labeledValue(detailText, "Job Type");
  const salary = labeledValue(detailText, "Salary");
  const industry = labeledValue(detailText, "Industry");
  const hours = labeledValue(detailText, "Hours");
  const jobId = normalizeText(params.pageUrl.match(/\/(\d{5,})(?:[/?#]|$)/)?.[1] || job.sourceJobId);

  return refreshJobQuality({
    ...job,
    sourceJobId: jobId,
    location: job.location || sideLocation,
    salary: job.salary || salary,
    contractType: job.contractType || jobType,
    workPattern: job.workPattern || hours,
    sector: job.sector || industry,
    siteSpecificFields: {
      ...job.siteSpecificFields,
      manpowerJobId: jobId,
      manpowerJobType: jobType,
      manpowerSalary: salary,
      manpowerIndustry: industry,
      manpowerHours: hours,
      manpowerLocation: sideLocation
    }
  });
}

export const manpowerAdapter = createGenericAdapter({
  siteId: "manpower",
  siteName: "Manpower UK",
  baseUrl: "https://www.manpower.co.uk",
  crawlMode: "playwright",
  detailMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.manpower.co.uk/en-gb/search", {
      searchJobText: input.title,
      searchLocation: input.location
    });
  },
  extractJob: extractManpowerJob
});
