import * as cheerio from "cheerio";
import { createGenericAdapter, defaultSearchUrl, haysListingJobs } from "./generic.adapter.js";
import type { JobRecord } from "../core/types.js";
import { parsePostedDate } from "../core/dateParser.js";
import { parseJsonLdJobs, type ListingHint } from "../core/jobExtractor.js";
import {
  absoluteUrl,
  completeJobRecord,
  extractCurrency,
  extractEmail,
  extractPhone,
  normalizeText,
  stripHtml
} from "../core/normalize.js";

function cleanLines(value: string): string {
  return value
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function htmlToText(html?: string): string {
  if (!html) return "";
  const $ = cheerio.load(`<section>${html}</section>`);
  $("br").replaceWith("\n");
  $("li").each((_, li) => {
    const text = normalizeText($(li).text());
    $(li).replaceWith(text ? `\n- ${text}\n` : "\n");
  });
  $("p, h2, h3, h4, strong, div").each((_, block) => {
    $(block).append("\n");
  });
  return cleanLines($.text());
}

function haysHeaderFields($: cheerio.CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $("header.job-description__header h4").each((_, heading) => {
    const label = normalizeText($(heading).text());
    const parentText = normalizeText($(heading).parent().text());
    const value = normalizeText(parentText.startsWith(label) ? parentText.slice(label.length) : parentText);
    if (label && value) fields[label.toLowerCase()] = value;
  });
  return fields;
}

function haysContactEmail($: cheerio.CheerioAPI, contactText: string): string {
  return haysContactEmails($, contactText)[0] || "";
}

function haysContactEmails($: cheerio.CheerioAPI, contactText: string): string[] {
  const emails = new Set<string>();
  const matches = contactText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  for (const match of matches) emails.add(match);

  $("a[href^='mailto:']").each((_, link) => {
    const href = $(link).attr("href") || "";
    const address = decodeURIComponent(href.replace(/^mailto:/i, "").split("?")[0]);
    const email = extractEmail(address);
    if (email) emails.add(email);
  });
  return [...emails];
}

function emailMatchesRecruiter(email: string, recruiterName: string): boolean {
  const parts = normalizeText(recruiterName)
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .split(/\s+/)
    .filter((part) => part.length > 1);
  if (parts.length < 2) return true;

  const first = parts[0];
  const last = parts[parts.length - 1];
  const local = normalizeText(email.split("@")[0] || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return local === `${first}${last}` || local.includes(first + last) || (local.includes(first) && local.includes(last));
}

function verifiedHaysEmail($: cheerio.CheerioAPI, text: string, recruiterName: string): string {
  const emails = haysContactEmails($, text);
  if (emails.length === 0) return "";
  if (!recruiterName) return emails[0];
  return emails.find((email) => emailMatchesRecruiter(email, recruiterName)) || "";
}

function haysRecruiterName(contactText: string): string {
  const namePart = "[A-Z][A-Za-z'â€™-]*";
  return (
    normalizeText(contactText.match(new RegExp(`Talk to\\s+(${namePart}(?:\\s+${namePart}){1,4})\\b`))?.[1] || "") ||
    normalizeText(
      contactText.match(new RegExp(`#\\d+\\s*-\\s*(${namePart}(?:\\s+${namePart}){1,4})\\b`))?.[1] || ""
    ) ||
    normalizeText(
      contactText.match(new RegExp(`consultant managing this position\\s+(${namePart}(?:\\s+${namePart}){1,4})\\b`))?.[1] ||
        ""
    )
  );
}

function haysEmailPattern(recruiterName: string): string {
  const parts = normalizeText(recruiterName)
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return "";
  return "firstname.lastname@hays.com";
}

function haysContactSection(contactText: string): string {
  const cleaned = cleanLines(
    contactText
      .replace(/Click here to access our Privacy Policy[\s\S]*/i, "")
      .replace(/api_key:[\s\S]*/i, "")
  );
  return cleaned ? `Contact\n${cleaned}` : "";
}

function extractHaysJob(params: {
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
  const jsonLd = parseJsonLdJobs(rawJsonLd).find((item) => item["@type"] === "JobPosting") || parseJsonLdJobs(rawJsonLd)[0];
  const fields = haysHeaderFields($);
  const contactText = normalizeText($(".jobDetailApply").first().text());
  const pageText = normalizeText($("body").text());
  const description = cleanLines(
    [
      normalizeText($(".job-description__header h4.fs-500, .job-description__header h4.fs-lg-600").first().text()),
      htmlToText(jsonLd?.description) || stripHtml($(".job-description__body, .job-description").first().html() || ""),
      haysContactSection(contactText)
    ]
      .filter(Boolean)
      .join("\n\n")
  );
  const sourceJobId =
    normalizeText(params.listingHint?.sourceJobId) ||
    normalizeText(params.pageUrl.match(/_(\d{5,})(?:[/?#]|$)/)?.[1] || "");
  const salary =
    normalizeText(fields.pay) ||
    normalizeText(jsonLd?.baseSalary?.value?.value || jsonLd?.baseSalary?.value || params.listingHint?.salary || "");
  const currencyText = normalizeText(jsonLd?.salaryCurrency || jsonLd?.baseSalary?.currency || salary);
  const recruiterPhone = extractPhone(contactText);
  const recruiterName = haysRecruiterName(`${contactText} ${pageText}`);
  const recruiterEmail = verifiedHaysEmail($, `${contactText} ${description} ${pageText}`, recruiterName);

  return completeJobRecord(
    {
      jobTitle:
        normalizeText($("#jd_title").first().text()) ||
        normalizeText(jsonLd?.title) ||
        params.listingHint?.jobTitle ||
        "",
      originalSearchTitle: params.listingHint?.originalSearchTitle,
      matchedSearchTitle: params.listingHint?.matchedSearchTitle,
      aiExpandedTitleUsed: params.listingHint?.aiExpandedTitleUsed,
      company: normalizeText(jsonLd?.hiringOrganization?.name || "Hays"),
      location: normalizeText(fields.location || params.listingHint?.location || ""),
      salary,
      currency: extractCurrency(currencyText) || currencyText,
      jobType: normalizeText(jsonLd?.employmentType || fields["job type"] || ""),
      jobFunction: normalizeText(fields.specialism || ""),
      sector: normalizeText(fields.industry || jsonLd?.industry || ""),
      contractType: normalizeText(fields["job type"] || jsonLd?.employmentType || ""),
      workPattern: normalizeText(fields["working pattern"] || ""),
      postedDate: parsePostedDate(jsonLd?.datePosted) || params.listingHint?.postedDate || "",
      closingDate: parsePostedDate(jsonLd?.validThrough),
      description,
      recruiterName,
      recruiterEmail,
      recruiterEmailSource: recruiterEmail ? "public_page" : "not_publicly_available_hays_pattern_known",
      recruiterEmailPattern: !recruiterEmail ? haysEmailPattern(recruiterName) : "",
      recruiterPhone,
      applyUrl: absoluteUrl($('a[href*="apply"]').first().attr("href") || params.pageUrl, params.pageUrl),
      jobUrl: params.pageUrl,
      sourceJobId,
      siteSpecificFields: {
        haysJobReference: sourceJobId,
        haysJobType: normalizeText(fields["job type"] || ""),
        haysWorkingPattern: normalizeText(fields["working pattern"] || ""),
        haysSpecialism: normalizeText(fields.specialism || ""),
        haysIndustry: normalizeText(fields.industry || ""),
        haysPay: normalizeText(fields.pay || ""),
        haysConsultantOffice: normalizeText(contactText.match(/Located in\s*(.*?)(?:Telephone|$)/i)?.[1] || ""),
        haysConsultantEmailPattern: !recruiterEmail ? haysEmailPattern(recruiterName) : ""
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

export const haysAdapter = createGenericAdapter({
  siteId: "hays",
  siteName: "Hays UK",
  baseUrl: "https://www.hays.co.uk",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.hays.co.uk/job-search", {
      q: input.title,
      location: input.location,
      sortType: "1"
    });
  },
  collectListingJobs: haysListingJobs,
  extractJob: extractHaysJob
});
