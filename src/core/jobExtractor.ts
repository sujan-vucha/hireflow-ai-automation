import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { JobRecord } from "./types.js";
import { parsePostedDate } from "./dateParser.js";
import {
  absoluteUrl,
  completeJobRecord,
  extractCurrency,
  extractEmail,
  extractPhone,
  extractSalary,
  normalizeText,
  stripHtml
} from "./normalize.js";
import { selectors } from "./selectors.js";

export type ListingHint = Partial<JobRecord> & {
  listingText?: string;
  detailUrlCandidates?: string[];
};

function firstText($: CheerioAPI, candidates: string[]): string {
  for (const selector of candidates) {
    const value = normalizeText($(selector).first().text());
    if (value) return value;
  }
  return "";
}

function metaContent($: CheerioAPI, name: string): string {
  return normalizeText($(`meta[property="${name}"], meta[name="${name}"]`).attr("content"));
}

export function parseJsonLdJobs(rawScripts: string[]): any[] {
  const jobs: any[] = [];

  function visit(value: any) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;

    const type = value["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) {
      jobs.push(value);
    }
    if (value["@graph"]) visit(value["@graph"]);
  }

  for (const raw of rawScripts) {
    try {
      visit(JSON.parse(raw));
    } catch {
      // Ignore invalid JSON-LD.
    }
  }

  return jobs;
}

function jsonLdLocation(job: any): string {
  if (!job) return "";
  const location = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation;
  const address = location?.address || {};
  return normalizeText(
    [
      address.addressLocality,
      address.addressRegion,
      address.addressCountry,
      typeof location === "string" ? location : ""
    ]
      .filter(Boolean)
      .join(", ")
  );
}

function jsonLdSalary(job: any): string {
  if (!job) return "";
  const base = job.baseSalary;
  if (!base) return "";
  const value = base.value;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return normalizeText(
    [
      value?.value,
      value?.minValue && value?.maxValue ? `${value.minValue} - ${value.maxValue}` : "",
      value?.unitText
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function extractRecruiterName(text: string): string {
  const patterns = [
    /(?:consultant|recruiter|contact|speak to|talk to)\s*[:\-]?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:is|,)?\s*(?:the\s*)?(?:consultant|recruiter|contact)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return "";
}

export function collectJobUrlsFromHtml(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const page = new URL(pageUrl);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const abs = absoluteUrl(href, pageUrl);
    if (!abs) return;

    const parsed = new URL(abs);
    const lower = abs.toLowerCase();
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    if (!abs) return;
    if (parsed.hostname !== page.hostname) return;
    if (abs.split("#")[0] === pageUrl.split("#")[0]) return;
    if (
      lower.includes("/apply") ||
      lower.includes("/login") ||
      lower.includes("/register") ||
      lower.includes("/account") ||
      lower.includes("/job-alert") ||
      lower.includes("/saved-job") ||
      lower.includes("submit-your-cv") ||
      lower.includes("upload-cv")
    ) {
      return;
    }

    const categoryLike =
      /^\/?jobs?$/.test(path.replace(/^\//, "")) ||
      /\/jobs\/(s-|q-|r-|remote|contract|permanent|temporary|training|job-alert|saved-jobs)(\/|$)/i.test(path) ||
      /\/jobs\/search$/i.test(path) ||
      /\/jobs\/(?:annual|daily|hourly)-\d+/i.test(path) ||
      /\/jobs\/(audit|banking|business-support|compliance|construction|digital|finance|health|human|insurance|legal|marketing|sales|technology|retail|tax|property|public-sector)(\/|$)/i.test(path);

    const detailLike =
      path.includes("/job-detail") ||
      path.includes("/job/") ||
      path.includes("/vacancy-detail") ||
      path.includes("/candidate/so/") ||
      /\/job\/\d{5,}\//i.test(path) ||
      /\/job-search\/[^/?#]+\/broadbean_\d+/i.test(path) ||
      /\/jobs\/search\/\d{4,}/i.test(path) ||
      /\/jobs\/[^/?#]*[_-]\d{4,}/i.test(path) ||
      /\/opp\/\d{4,}/i.test(path);

    if (!categoryLike && detailLike) {
      urls.add(abs.split("#")[0]);
    }
  });

  return [...urls];
}

export function findNextPageUrl(html: string, pageUrl: string): string {
  const $ = cheerio.load(html);
  const relNext = $('a[rel="next"]').attr("href");
  if (relNext) return absoluteUrl(relNext, pageUrl);

  let next = "";
  $("a[href], button").each((_, el) => {
    const text = normalizeText($(el).text()).toLowerCase();
    if (!next && /^(next|show more|load more|more jobs|>)$/.test(text)) {
      const href = $(el).attr("href");
      if (href) next = absoluteUrl(href, pageUrl);
    }
  });
  return next;
}

export function extractJobFromHtml(params: {
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
  const jsonLd = parseJsonLdJobs(rawJsonLd)[0];

  $("script, style, noscript, template, svg").remove();
  const bodyText = normalizeText($("body").text());
  const description =
    stripHtml(jsonLd?.description) ||
    firstText($, selectors.description) ||
    bodyText.slice(0, 12000);
  const visibleRecruiterText = firstText($, selectors.recruiter) || bodyText;
  const postedDate =
    parsePostedDate(jsonLd?.datePosted) ||
    parsePostedDate(firstText($, selectors.postedDate)) ||
    parsePostedDate(bodyText) ||
    params.listingHint?.postedDate ||
    "";

  const closingDate =
    parsePostedDate(jsonLd?.validThrough) ||
    parsePostedDate(bodyText.match(/(?:closing date|closes on|valid through)[:\s]+.{0,40}/i)?.[0] || "");

  const jobTitle =
    normalizeText(jsonLd?.title) ||
    firstText($, selectors.title) ||
    metaContent($, "og:title") ||
    params.listingHint?.jobTitle ||
    "";
  const location =
    jsonLdLocation(jsonLd) ||
    firstText($, selectors.location) ||
    params.listingHint?.location ||
    "";
  const salary =
    jsonLdSalary(jsonLd) ||
    firstText($, selectors.salary) ||
    params.listingHint?.salary ||
    extractSalary(bodyText);
  const recruiterEmail = extractEmail(visibleRecruiterText);
  const recruiterPhone = extractPhone(visibleRecruiterText);

  return completeJobRecord(
    {
      jobTitle,
      originalSearchTitle: params.listingHint?.originalSearchTitle,
      matchedSearchTitle: params.listingHint?.matchedSearchTitle,
      aiExpandedTitleUsed: params.listingHint?.aiExpandedTitleUsed,
      company: normalizeText(jsonLd?.hiringOrganization?.name || params.listingHint?.company || ""),
      location,
      salary,
      currency: normalizeText(jsonLd?.baseSalary?.currency || extractCurrency(salary)),
      jobType: normalizeText(jsonLd?.employmentType || params.listingHint?.jobType || ""),
      contractType: normalizeText(params.listingHint?.contractType || ""),
      workPattern: normalizeText(params.listingHint?.workPattern || ""),
      postedDate,
      closingDate,
      description,
      recruiterName: extractRecruiterName(visibleRecruiterText),
      recruiterEmail,
      recruiterPhone,
      applyUrl: absoluteUrl($('a[href*="apply"]').first().attr("href") || params.pageUrl, params.pageUrl),
      jobUrl: params.pageUrl,
      sourceJobId:
        normalizeText(jsonLd?.identifier?.value || jsonLd?.identifier || "") ||
        normalizeText(params.pageUrl.match(/(?:_|\/)(\d{5,})(?:[/?#]|$)/)?.[1] || "")
    },
    {
      sourceSite: params.sourceSite,
      agency: params.agency,
      matchKeyword: params.matchKeyword,
      dateRangeMatched: params.dateRangeMatched
    }
  );
}
