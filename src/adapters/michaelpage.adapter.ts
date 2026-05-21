import * as cheerio from "cheerio";
import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";
import type { JobRecord } from "../core/types.js";
import { parsePostedDate } from "../core/dateParser.js";
import {
  absoluteUrl,
  completeJobRecord,
  extractCurrency,
  extractEmail,
  extractPhone,
  extractSalary,
  normalizeText,
  stripHtml
} from "../core/normalize.js";
import { parseJsonLdJobs, type ListingHint } from "../core/jobExtractor.js";

function cleanLines(value: string): string {
  return value
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function textWithBreaks($: cheerio.CheerioAPI, selector: string): string {
  const element = $(selector).first();
  if (!element.length) return "";

  const clone = element.clone();
  clone.find("script, style, noscript, svg").remove();
  clone.find("br").replaceWith("\n");
  clone.find("li").each((_, li) => {
    const text = normalizeText($(li).text());
    $(li).replaceWith(text ? `\n- ${text}\n` : "\n");
  });
  clone.find("p, h2, h3, h4, div").each((_, block) => {
    $(block).append("\n");
  });

  return cleanLines(clone.text());
}

function summaryFields($: cheerio.CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $("dt.summary-detail-field-label").each((_, label) => {
    const key = normalizeText($(label).text());
    const value = normalizeText($(label).next("dd.summary-detail-field-value").text());
    if (key && value) fields[key.toLowerCase()] = value;
  });
  return fields;
}

function jsonLdField(rawJsonLd: string, fieldName: string): string {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const value = rawJsonLd.match(pattern)?.[1] || "";
  return normalizeText(value.replace(/\\"/g, '"').replace(/\\\//g, "/"));
}

function section(label: string, text: string): string {
  return text ? `${label}\n${text}` : "";
}

function buildMichaelPageDescription($: cheerio.CheerioAPI, summary: Record<string, string>, jsonDescription: string): string {
  const highlights = textWithBreaks($, ".job_advert__job-desc-bullet-points");
  const aboutClient = textWithBreaks($, ".job_advert__job-desc-company");
  const jobDescription = textWithBreaks($, ".job_advert__job-desc-role");
  const successfulApplicant = textWithBreaks($, ".job_advert__job-desc-candidate");
  const offer = textWithBreaks($, ".job_advert__job-desc-deal");

  const contactLines = [
    summary["consultant name"] || normalizeText($(".job-contact-info .contact-name").first().text()),
    summary["job reference"] ? `Quote job ref\n${summary["job reference"]}` : "",
    summary["consultant phone"] ? `Phone number\n${summary["consultant phone"]}` : ""
  ].filter(Boolean);

  const summaryLines = [
    ["Job function", summary["job function"]],
    ["Subsector", summary.subsector],
    ["Sector", summary.sector],
    ["Location", summary.location],
    ["Contract type", summary["contract type"]],
    ["Consultant name", summary["consultant name"]],
    ["Consultant phone", summary["consultant phone"]],
    ["Job reference", summary["job reference"]]
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}\n${value}`);

  return cleanLines(
    [
      highlights,
      section("About Our Client", aboutClient),
      section("Job Description", jobDescription),
      section("The Successful Applicant", successfulApplicant),
      section("What's on Offer", offer),
      section("Contact", contactLines.join("\n")),
      section("Job summary", summaryLines.join("\n")),
      !highlights && !aboutClient && !jobDescription ? stripHtml(jsonDescription) : ""
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}

function extractMichaelPageJob(params: {
  html: string;
  pageUrl: string;
  sourceSite: string;
  agency: string;
  matchKeyword: string;
  dateRangeMatched: boolean;
  listingHint?: ListingHint;
}): JobRecord {
  const $ = cheerio.load(params.html);
  const rawJsonLd: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    rawJsonLd.push($(el).text());
  });
  const rawJsonText = rawJsonLd.join("\n");
  const jsonLd = parseJsonLdJobs(rawJsonLd)[0];
  const summary = summaryFields($);
  const description = buildMichaelPageDescription($, summary, jsonLd?.description || "");
  const visibleText = normalizeText($("body").text());
  const recruiterName = summary["consultant name"] || normalizeText($(".job-contact-info").text().match(/Contact\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/)?.[1] || "");
  const recruiterPhone = summary["consultant phone"] || extractPhone($(".job-contact-info").text() || visibleText);
  const jobReference =
    summary["job reference"] ||
    normalizeText(params.pageUrl.match(/\/ref\/([^/?#]+)/i)?.[1] || "") ||
    normalizeText(visibleText.match(/JN-\d{6}-\d+/i)?.[0] || "");

  return completeJobRecord(
    {
      jobTitle:
        normalizeText($(".job-apply-job-title").first().text()) ||
        normalizeText(jsonLd?.title) ||
        jsonLdField(rawJsonText, "title") ||
        params.listingHint?.jobTitle ||
        "",
      company: normalizeText(jsonLd?.hiringOrganization?.name || "Michael Page"),
      location: summary.location || normalizeText($(".job-location").first().text()) || params.listingHint?.location || "",
      salary: normalizeText($(".job-salary").first().text()) || params.listingHint?.salary || extractSalary(visibleText),
      currency: extractCurrency(visibleText),
      jobType: normalizeText(jsonLd?.employmentType || jsonLdField(rawJsonText, "employmentType") || summary["job function"] || ""),
      jobFunction: summary["job function"] || normalizeText(jsonLd?.industry || jsonLdField(rawJsonText, "industry")),
      sector: summary.sector || "",
      subsector: summary.subsector || "",
      contractType: summary["contract type"] || normalizeText($(".job-contract-type").first().text()),
      postedDate: parsePostedDate(jsonLd?.datePosted || jsonLdField(rawJsonText, "datePosted")),
      closingDate: parsePostedDate(jsonLd?.validThrough || jsonLdField(rawJsonText, "validThrough")),
      description,
      recruiterName,
      recruiterEmail: extractEmail($(".job-contact-info").text() || visibleText),
      recruiterPhone,
      applyUrl: absoluteUrl($('a.apply-job, a[href*="/apply"]').first().attr("href") || params.pageUrl, params.pageUrl),
      jobUrl: params.pageUrl,
      sourceJobId: jobReference,
      siteSpecificFields: {
        michaelPageJobReference: jobReference,
        michaelPageJobFunction: summary["job function"] || "",
        michaelPageSubsector: summary.subsector || "",
        michaelPageSector: summary.sector || "",
        michaelPageConsultantName: summary["consultant name"] || recruiterName,
        michaelPageConsultantPhone: summary["consultant phone"] || recruiterPhone,
        michaelPageContractType: summary["contract type"] || "",
        michaelPageLocation: summary.location || ""
      }
    },
    {
      sourceSite: params.sourceSite,
      agency: params.agency,
      matchKeyword: params.matchKeyword,
      dateRangeMatched: params.dateRangeMatched
    }
  );
}

export const michaelPageAdapter = createGenericAdapter({
  siteId: "michaelpage",
  siteName: "Michael Page UK",
  baseUrl: "https://www.michaelpage.co.uk",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.michaelpage.co.uk/jobs", {
      search: input.title,
      location: input.location
    });
  },
  extractJob: extractMichaelPageJob
});
