import * as cheerio from "cheerio";
import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";
import type { JobRecord } from "../core/types.js";
import { parsePostedDate } from "../core/dateParser.js";
import { extractJobFromHtml, type ListingHint } from "../core/jobExtractor.js";
import { extractEmail, normalizeText, refreshJobQuality } from "../core/normalize.js";

function label(text: string, name: string, nextLabel: string): string {
  const pattern = new RegExp(`${name}:\\s*(.+?)\\s+${nextLabel}:`, "i");
  return normalizeText(text.match(pattern)?.[1] || "");
}

function extractJacJob(params: {
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
  const mainText = normalizeText($("#haml-structure").first().text() || $("body").text());
  const jobTitle = label(mainText, "Job title", "Location");
  const location = label(mainText, "Location", "Specialisation");
  const specialisation = label(mainText, "Specialisation", "Salary");
  const salary = label(mainText, "Salary", "Reference");
  const reference = label(mainText, "Reference", "Job published");
  const published = label(mainText, "Job published", "Company");
  const company = label(mainText, "Company", "Positions");
  const contactEmail = extractEmail($('a[href^="mailto:"]').last().attr("href") || mainText);

  return refreshJobQuality({
    ...job,
    jobTitle: job.jobTitle || jobTitle,
    company: job.company || company,
    location: job.location || location,
    salary: job.salary || salary,
    jobFunction: job.jobFunction || specialisation,
    sourceJobId: job.sourceJobId || reference || normalizeText(params.pageUrl.match(/-(\d{5,})(?:[/?#]|$)/)?.[1] || ""),
    postedDate: job.postedDate || parsePostedDate(published),
    recruiterEmail: contactEmail || job.recruiterEmail,
    recruiterEmailSource: contactEmail ? "public_mailto" : job.recruiterEmailSource,
    siteSpecificFields: {
      ...job.siteSpecificFields,
      jacReference: reference,
      jacSpecialisation: specialisation,
      jacCompany: company,
      jacJobPublished: published,
      jacContactEmail: contactEmail
    }
  });
}

export const jacAdapter = createGenericAdapter({
  siteId: "jac",
  siteName: "JAC Recruitment UK",
  baseUrl: "https://www.jac-recruitment.co.uk",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.jac-recruitment.co.uk/jobs", {
      keywords: input.title,
      location: input.location
    });
  },
  extractJob: extractJacJob
});
