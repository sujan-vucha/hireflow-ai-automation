import * as cheerio from "cheerio";
import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";
import type { JobRecord } from "../core/types.js";
import { parsePostedDate } from "../core/dateParser.js";
import { extractJobFromHtml, type ListingHint } from "../core/jobExtractor.js";
import { normalizeText, refreshJobQuality } from "../core/normalize.js";

function extractRobertHalfJob(params: {
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
  const bodyText = normalizeText($("body").text());
  const title = normalizeText($(".rhcl-job-card__headline-wrapper__job-title").first().text());
  const location = normalizeText($(".rhcl-job-card__headline-wrapper__location").first().text());
  const detailText = normalizeText($(".rhcl-job-card__details-list-wrapper").first().text());
  const posted = normalizeText(
    $(".rhcl-job-card__posted-wrapper").first().text() ||
      bodyText.match(/Posted\s*[—-]\s*(.+?)(?:Have an account|Description|Job Reference|$)/i)?.[1] ||
      ""
  );
  const jobReference = normalizeText(bodyText.match(/Job Reference:\s*([A-Z0-9-]+)/i)?.[1] || params.pageUrl.match(/\/([^/]+-uken)(?:[/?#]|$)/)?.[1] || "");
  const staffingArea = normalizeText(bodyText.match(/Staffing Area:\s*(.+?)(?:Have an account|Description|$)/i)?.[1] || "");
  const contractType = normalizeText(detailText.match(/\b(Permanent|Contract|Temporary|Interim|Part Time|Full Time)\b/i)?.[1] || "");
  const salary = normalizeText(detailText.replace(contractType, "").replace(/rhcl-list-base.*?theme\);?\s*/i, ""));

  return refreshJobQuality({
    ...job,
    jobTitle: job.jobTitle || title,
    location: job.location || location,
    salary: job.salary || salary,
    contractType: job.contractType || contractType,
    sector: job.sector || staffingArea,
    sourceJobId: job.sourceJobId || jobReference,
    postedDate: job.postedDate || parsePostedDate(posted),
    siteSpecificFields: {
      ...job.siteSpecificFields,
      robertHalfJobReference: jobReference,
      robertHalfStaffingArea: staffingArea,
      robertHalfPostedText: posted,
      robertHalfEmploymentType: contractType,
      robertHalfSalaryText: salary
    }
  });
}

export const robertHalfAdapter = createGenericAdapter({
  siteId: "roberthalf",
  siteName: "Robert Half UK",
  baseUrl: "https://www.roberthalf.com",
  crawlMode: "cheerio",
  detailMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.roberthalf.com/gb/en/jobs", {
      keywords: input.title,
      location: input.location
    });
  },
  extractJob: extractRobertHalfJob
});
