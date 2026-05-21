import * as cheerio from "cheerio";
import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";
import type { JobRecord } from "../core/types.js";
import { parsePostedDate } from "../core/dateParser.js";
import { extractJobFromHtml, type ListingHint } from "../core/jobExtractor.js";
import { extractEmail, extractPhone, normalizeText, refreshJobQuality } from "../core/normalize.js";

function firstMatch(text: string, pattern: RegExp): string {
  return normalizeText(text.match(pattern)?.[1] || "");
}

function extractMorganHuntJob(params: {
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
  const infoText = normalizeText($(".job-informations").first().text()) || bodyText;
  const consultantText = normalizeText($(".job-consultant").first().text());
  const recruiterEmail =
    extractEmail(consultantText) ||
    extractEmail($('a[href^="mailto:"]').first().attr("href") || "");
  const consultantName = normalizeText($(".job-consultant-name").first().text());
  const consultantRole = normalizeText($(".job-consultant-position").first().text());
  const jobRef = firstMatch(infoText, /Job Ref:\s*(.+?)\s*Location:/i);
  const datePosted = parsePostedDate(firstMatch(infoText, /Date Posted:\s*(.+?)\s*Job Type:/i));
  const contractType = firstMatch(infoText, /Job Type:\s*(.+?)(?:$|Digital|[A-Z][a-z]+\s+[A-Z][a-z]+)/i);
  const sector = normalizeText($(".job-tags").first().text());
  const client = normalizeText($(".job-client").first().text());

  return refreshJobQuality({
    ...job,
    company: job.company || client,
    sector: job.sector || sector,
    contractType: job.contractType || contractType,
    postedDate: job.postedDate || datePosted,
    recruiterName: consultantName || job.recruiterName,
    recruiterEmail: recruiterEmail || job.recruiterEmail,
    recruiterEmailSource: recruiterEmail ? "public_mailto" : job.recruiterEmailSource,
    recruiterPhone: extractPhone(consultantText) || job.recruiterPhone,
    sourceJobId: job.sourceJobId || jobRef || firstMatch(params.pageUrl, /\/jobs\/search\/(\d+)/i),
    siteSpecificFields: {
      ...job.siteSpecificFields,
      morganHuntJobRef: jobRef,
      morganHuntClient: client,
      morganHuntSector: sector,
      morganHuntConsultantName: consultantName,
      morganHuntConsultantRole: consultantRole,
      morganHuntConsultantEmail: recruiterEmail,
      morganHuntJobType: contractType
    }
  });
}

export const morganHuntAdapter = createGenericAdapter({
  siteId: "morganhunt",
  siteName: "Morgan Hunt",
  baseUrl: "https://www.morganhunt.com",
  crawlMode: "cheerio",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.morganhunt.com/jobs/search", {
      keywords: input.title,
      location: input.location
    });
  },
  extractJob: extractMorganHuntJob
});
