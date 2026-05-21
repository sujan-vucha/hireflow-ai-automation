import * as cheerio from "cheerio";
import { chromium, type Browser } from "playwright";
import type { CheerioAPI } from "cheerio";
import type { JobRecord, ScrapeInput, ScrapeResult, SiteAdapter, SiteRunStatus } from "../core/types.js";
import { dedupeJobs } from "../core/dedupe.js";
import { isWithinDateRange, parsePostedDate } from "../core/dateParser.js";
import {
  absoluteUrl,
  completeJobRecord,
  extractSalary,
  matchesKeyword,
  matchesLocation,
  matchesStrictTitle,
  normalizeText,
  searchKeywordAlternatives,
  slugify
} from "../core/normalize.js";
import { collectJobUrlsFromHtml, extractJobFromHtml, findNextPageUrl, type ListingHint } from "../core/jobExtractor.js";
import { logger } from "../core/logger.js";
import { detectAccessStatus, shouldSkipUrl } from "../core/safety.js";
import { withRetry } from "../core/retryPolicy.js";
import { delay } from "../core/rateLimiter.js";

type CrawlMode = "cheerio" | "playwright";

type GenericAdapterConfig = {
  siteId: string;
  siteName: string;
  baseUrl: string;
  supportsApi?: boolean;
  crawlMode: CrawlMode;
  detailMode?: CrawlMode;
  buildSearchUrl: (input: ScrapeInput, searchTitle: string, page: number) => string;
  collectListingJobs?: ($: CheerioAPI, pageUrl: string, input: ScrapeInput) => ListingHint[];
  extractJob?: (params: {
    html: string;
    pageUrl: string;
    sourceSite: string;
    agency: string;
    matchKeyword: string;
    dateRangeMatched: boolean;
    listingHint?: ListingHint;
  }) => JobRecord;
};

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type PageData = {
  html: string;
  visibleText: string;
  finalUrl: string;
  statusCode: number;
};

let sharedBrowser: Promise<Browser> | null = null;

async function getSharedBrowser(headless: boolean): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = chromium.launch({ headless });
  }
  return sharedBrowser;
}

export async function closeSharedBrowser(): Promise<void> {
  const browser = await sharedBrowser?.catch(() => null);
  sharedBrowser = null;
  await browser?.close().catch(() => undefined);
}

async function fetchHtml(url: string): Promise<PageData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9"
      },
      redirect: "follow"
    });
    const html = await response.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, template, svg").remove();
    return {
      html,
      visibleText: normalizeText($("body").text()),
      finalUrl: response.url || url,
      statusCode: response.status
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function renderHtml(url: string, headless: boolean): Promise<PageData> {
  const browser = await getSharedBrowser(headless);
  const page = await browser.newPage({ userAgent, locale: "en-GB" });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(1000);
    await page.evaluate(async () => {
      const maxY = Math.min(document.body.scrollHeight || 0, 4500);
      for (let y = 0; y <= maxY; y += 1500) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(350);
    return {
      html: await page.content(),
      visibleText: normalizeText(await page.locator("body").innerText().catch(() => "")),
      finalUrl: page.url(),
      statusCode: response?.status() || 0
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function resultFor(config: GenericAdapterConfig, input: ScrapeInput, overrides: Partial<ScrapeResult>): ScrapeResult {
  return {
    siteId: config.siteId,
    siteName: config.siteName,
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

function inferStatus(params: {
  totalFound: number;
  totalAfterDateFilter: number;
  jobs: JobRecord[];
  warnings: string[];
  errors: string[];
  stoppedByLimit: boolean;
  sawNoResultsText: boolean;
}): { status: SiteRunStatus; reason: string } {
  if (params.totalFound === 0) {
    if (params.sawNoResultsText) {
      return {
        status: "NO_MATCHING_JOBS",
        reason: "The public search page reported no matching jobs."
      };
    }
    return {
      status: "SELECTOR_FAILURE",
      reason: "No public job detail URLs were found. Selectors or site search URL may need adjustment."
    };
  }
  if (params.totalAfterDateFilter === 0) {
    return {
      status: "NO_MATCHING_JOBS",
      reason: "Public jobs were found, but none had a public posted date inside the selected date range."
    };
  }
  if (params.jobs.length === 0) {
    return {
      status: "NO_MATCHING_JOBS",
      reason: "Public jobs matched the selected date range, but none passed the keyword and location filters."
    };
  }
  if (params.errors.length > 0 && params.jobs.length > 0) {
    return { status: "PARTIAL_SUCCESS", reason: "Some jobs were scraped, but one or more pages failed." };
  }
  if (params.warnings.length > 0) {
    return { status: "SUCCESS_WITH_WARNINGS", reason: "Jobs scraped with warnings." };
  }
  if (!params.stoppedByLimit) {
    return { status: "ALL_AVAILABLE_SCRAPED", reason: "All discovered public jobs in scope were scraped." };
  }
  return { status: "SUCCESS", reason: "Scrape completed." };
}

function defaultListingHints(html: string, pageUrl: string): ListingHint[] {
  return collectJobUrlsFromHtml(html, pageUrl).map((jobUrl) => ({ jobUrl }));
}

function isNoResultsPage(text: string): boolean {
  return /\b(sorry,? your search returned|no matching jobs|no jobs found|0 jobs|zero jobs|no vacancies found|no results found)\b/i.test(
    text
  );
}

function isNotFoundOrClosedPage(text: string): boolean {
  return /\b(404|page not found|job not found|vacancy not found|not available|no longer available|job has expired|vacancy has expired|this job has closed|this vacancy has closed|position has been filled)\b/i.test(
    text
  );
}

function validPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return !shouldSkipUrl(parsed.toString());
  } catch {
    return false;
  }
}

export function createGenericAdapter(config: GenericAdapterConfig): SiteAdapter {
  return {
    siteId: config.siteId,
    siteName: config.siteName,
    baseUrl: config.baseUrl,
    supportsApi: Boolean(config.supportsApi),
    buildSearchUrl: config.buildSearchUrl,

    async scrape(input: ScrapeInput): Promise<ScrapeResult> {
      const searchTerms = input.expandedTitles?.length
        ? input.expandedTitles
        : searchKeywordAlternatives(input.title);
      const searchUrls = new Map<string, string>();
      for (const term of searchTerms) {
        searchUrls.set(config.buildSearchUrl({ ...input, title: term }, term, 1), term);
      }
      const errors: string[] = [];
      const warnings: string[] = [];
      const listingHints = new Map<string, ListingHint>();
      let blocked: { status: SiteRunStatus; reason: string } | null = null;
      let pagesScraped = 0;
      let stoppedByLimit = false;
      let sawNoResultsText = false;
      let stoppedCollectingByMaxJobs = false;

      for (const [searchUrl, searchTerm] of searchUrls.entries()) {
        if (stoppedCollectingByMaxJobs) break;
        logger.site(config.siteName, `Search URL: ${searchUrl}`);
        if (searchTerms.length > 1) logger.site(config.siteName, `Search term: ${searchTerm}`);

        let currentUrl = searchUrl;
        let termPagesScraped = 0;
        while (currentUrl) {
          if (input.maxPages && termPagesScraped >= input.maxPages) {
            stoppedByLimit = true;
            break;
          }

          try {
            const pageData = await withRetry(
              () => (config.crawlMode === "playwright" ? renderHtml(currentUrl, input.headless) : fetchHtml(currentUrl)),
              { retries: 1 }
            );
            pagesScraped += 1;
            termPagesScraped += 1;
            logger.site(config.siteName, `Page ${termPagesScraped} scraped for "${searchTerm}" (${pagesScraped} total)`);

            if (pageData.statusCode >= 400) {
              errors.push(`Listing page returned HTTP ${pageData.statusCode}: ${pageData.finalUrl}`);
              if (pageData.statusCode === 401 || pageData.statusCode === 403) {
                blocked = {
                  status: pageData.statusCode === 401 ? "LOGIN_REQUIRED" : "ACCESS_RESTRICTED",
                  reason: `Public listing page returned HTTP ${pageData.statusCode}; site stopped without bypassing access controls.`
                };
              }
              break;
            }

            const access = detectAccessStatus(pageData.visibleText, pageData.finalUrl);
            if (!access.allowed) {
              blocked = {
                status: access.status === "ALLOWED" ? "ACCESS_RESTRICTED" : access.status,
                reason: access.reason || "Access restriction detected."
              };
              break;
            }
            if (isNoResultsPage(pageData.visibleText)) sawNoResultsText = true;

            const searchInput = { ...input, title: searchTerm };
            const $ = cheerio.load(pageData.html);
            let hints =
              config.collectListingJobs?.($, pageData.finalUrl, searchInput) ||
              defaultListingHints(pageData.html, pageData.finalUrl);

            if (hints.length === 0 && config.crawlMode === "cheerio") {
              warnings.push("No job cards found with Cheerio. Tried Playwright fallback for this page.");
              const rendered = await renderHtml(currentUrl, input.headless);
              const renderedAccess = detectAccessStatus(rendered.visibleText, rendered.finalUrl);
              if (!renderedAccess.allowed) {
                blocked = {
                  status:
                    renderedAccess.status === "ALLOWED" ? "ACCESS_RESTRICTED" : renderedAccess.status,
                  reason: renderedAccess.reason || "Access restriction detected."
                };
                break;
              }
              if (isNoResultsPage(rendered.visibleText)) sawNoResultsText = true;
              if (rendered.statusCode >= 400) {
                errors.push(`Rendered listing page returned HTTP ${rendered.statusCode}: ${rendered.finalUrl}`);
                break;
              }
              const rendered$ = cheerio.load(rendered.html);
              hints =
                config.collectListingJobs?.(rendered$, rendered.finalUrl, searchInput) ||
                defaultListingHints(rendered.html, rendered.finalUrl);
            }

            for (const hint of hints) {
              if (!hint.jobUrl || shouldSkipUrl(hint.jobUrl)) continue;
              listingHints.set(hint.jobUrl, {
                ...listingHints.get(hint.jobUrl),
                ...hint,
                originalSearchTitle: input.originalTitle || input.title,
                matchedSearchTitle: searchTerm,
                aiExpandedTitleUsed: searchTerm.toLowerCase() !== (input.originalTitle || input.title).toLowerCase()
              });
            }

            logger.site(config.siteName, `Job URLs found so far: ${listingHints.size}`);
            if (input.maxJobs && listingHints.size >= input.maxJobs * 5) {
              stoppedByLimit = true;
              stoppedCollectingByMaxJobs = true;
              break;
            }

            const next = findNextPageUrl(pageData.html, pageData.finalUrl);
            if (!next || next === currentUrl) break;
            currentUrl = next;
            await delay(800);
          } catch (error: any) {
            errors.push(`Listing page failed: ${currentUrl}: ${error?.message || error}`);
            break;
          }

          if (blocked) break;
        }

        if (blocked) break;
      }

      if (blocked) {
        return resultFor(config, input, {
          status: blocked.status,
          totalFound: listingHints.size,
          errors,
          warnings,
          reason: blocked.reason
        });
      }

      const detailJobs: JobRecord[] = [];
      let afterDateFilterCount = 0;
      let detailPagesOpened = 0;
      const detailEntries = input.maxJobs
        ? [...listingHints.entries()].slice(0, Math.max(input.maxJobs * 5, input.maxJobs))
        : [...listingHints.entries()];
      const detailMode = config.detailMode || "cheerio";

      async function loadDetail(jobUrl: string, hint: ListingHint): Promise<{ detail: PageData; attemptedUrl: string } | null> {
        const candidates = [jobUrl, ...(hint.detailUrlCandidates || [])]
          .filter(Boolean)
          .filter((url, index, urls) => urls.indexOf(url) === index);

        for (const candidate of candidates) {
          const detail = await withRetry(
            () => (detailMode === "playwright" ? renderHtml(candidate, input.headless) : fetchHtml(candidate)),
            { retries: 0 }
          );
          if (detail.statusCode < 400 && !isNotFoundOrClosedPage(detail.visibleText)) {
            return { detail, attemptedUrl: candidate };
          }
        }

        return null;
      }

      async function processDetail(jobUrl: string, hint: ListingHint) {
        try {
          const loaded = await loadDetail(jobUrl, hint);
          detailPagesOpened += loaded ? 1 : 0;
          if (!loaded) {
            warnings.push(`${jobUrl}: skipped because detail page returned HTTP 404 for all known URL candidates.`);
            return;
          }
          const { detail, attemptedUrl } = loaded;
          if (isNotFoundOrClosedPage(detail.visibleText)) {
            warnings.push(`${attemptedUrl}: skipped because the public detail page appears not found, expired, or closed.`);
            return;
          }
          const access = detectAccessStatus(detail.visibleText, detail.finalUrl);
          if (!access.allowed) {
            warnings.push(`${attemptedUrl}: ${access.reason || access.status}`);
            return;
          }

          const preliminaryDate =
            parsePostedDate(hint.postedDate) ||
            parsePostedDate(detail.visibleText.match(/(?:posted on|date posted|posted|updated)[:\s]+.{0,40}/i)?.[0] || "");
          const dateRangeMatched = isWithinDateRange(preliminaryDate, input.fromDate, input.toDate);
          const job = (config.extractJob || extractJobFromHtml)({
            html: detail.html,
            pageUrl: detail.finalUrl,
            sourceSite: config.siteName,
            agency: config.siteName,
            matchKeyword: input.title,
            dateRangeMatched,
            listingHint: {
              ...hint,
              postedDate: preliminaryDate || hint.postedDate
            }
          });
          const finalDateMatched = isWithinDateRange(job.postedDate, input.fromDate, input.toDate);
          job.dateRangeMatched = finalDateMatched;

          if (!job.postedDate) {
            warnings.push(`${attemptedUrl}: posted date not publicly available or not parseable.`);
            return;
          }
          if (!finalDateMatched) return;
          afterDateFilterCount += 1;
          if ((input.strictTitle ?? true) && !matchesStrictTitle(job, input.title)) {
            warnings.push(`${job.jobUrl}: skipped because title "${job.jobTitle}" did not strictly match "${input.title}".`);
            return;
          }
          if (input.strictKeyword && !matchesKeyword(job, input.title)) return;
          if (!matchesLocation(job, input.location)) return;
          if (!validPublicUrl(job.jobUrl)) {
            warnings.push(`${attemptedUrl}: skipped because the resolved job URL is not a valid public URL.`);
            return;
          }
          if (!validPublicUrl(job.applyUrl)) {
            job.applyUrl = job.jobUrl;
          }

          detailJobs.push(job);
        } catch (error: any) {
          errors.push(`Detail page failed: ${jobUrl}: ${error?.message || error}`);
        }
      }

      const detailConcurrency = 3;
      for (let i = 0; i < detailEntries.length; i += detailConcurrency) {
        if (input.maxJobs && detailJobs.length >= input.maxJobs) {
          stoppedByLimit = true;
          break;
        }
        await Promise.all(
          detailEntries
            .slice(i, i + detailConcurrency)
            .map(([jobUrl, hint]) => processDetail(jobUrl, hint))
        );
        await delay(500);
      }

      const deduped = dedupeJobs(detailJobs);
      const status = inferStatus({
        totalFound: listingHints.size,
        totalAfterDateFilter: afterDateFilterCount,
        jobs: deduped.jobs,
        warnings,
        errors,
        stoppedByLimit,
        sawNoResultsText
      });

      return resultFor(config, input, {
        status: status.status,
        totalFound: listingHints.size,
        totalScraped: deduped.jobs.length,
        totalAfterDateFilter: afterDateFilterCount,
        totalDuplicatesRemoved: deduped.duplicatesRemoved,
        pagesChecked: pagesScraped,
        jobCardsFound: listingHints.size,
        detailPagesOpened,
        jobsSaved: deduped.jobs.length,
        jobsFilteredByDate: Math.max(0, listingHints.size - afterDateFilterCount),
        jobsFilteredByRelevance: 0,
        jobs: deduped.jobs,
        errors,
        warnings,
        reason: status.reason
      });
    }
  };
}

export function defaultSearchUrl(baseUrl: string, params: Record<string, string>) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function legacyHaysDetailSlug(value: string): string {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u2013\u2014]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return encodeURIComponent(slug).replace(/%2D/gi, "-");
}

function haysEncodedSlug(value: string): string {
  const slug = normalizeText(value)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/\s+/g, "-")
    .replace(/,+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "");

  return encodeURIComponent(slug)
    .replace(/%2D/gi, "-")
    .replace(/%2F/gi, "-");
}

function haysDetailUrlCandidates(pageUrl: string, title: string, location: string, sourceJobId: string): string[] {
  const titleLocation = [title, location].filter(Boolean).join(" ");
  const encoded = haysEncodedSlug(titleLocation);
  const legacy = legacyHaysDetailSlug(titleLocation) || slugify(title);
  return [
    absoluteUrl(`/job-detail/${encoded}_${sourceJobId}`, pageUrl),
    absoluteUrl(`/job-detail/${encoded}-_${sourceJobId}`, pageUrl),
    absoluteUrl(`/job-detail/${legacy}_${sourceJobId}`, pageUrl)
  ]
    .map((url) => url.split("#")[0])
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

export function haysListingJobs($: CheerioAPI, pageUrl: string): ListingHint[] {
  const hints = new Map<string, ListingHint>();
  const hrefByRef = new Map<string, string>();

  $('a[href*="/job-detail/"]').each((_, link) => {
    const href = $(link).attr("href") || "";
    const ref = href.match(/_(\d{5,})(?:[/?#]|$)/)?.[1] || "";
    if (ref && !hrefByRef.has(ref)) {
      hrefByRef.set(ref, absoluteUrl(href, pageUrl).split("#")[0]);
    }
  });

  $("span#JobReference").each((_, refEl) => {
    const sourceJobId = normalizeText($(refEl).text());
    if (!sourceJobId) return;

    const card = $(refEl).closest(".mb-5");
    const jobTitle =
      normalizeText(card.find("span#JobTitle").first().text()) ||
      normalizeText(card.find("h4").first().text());
    const listingText = normalizeText(card.text());
    const location = normalizeText(card.find("li").first().text());
    const salary = extractSalary(listingText);
    const postedDate = parsePostedDate(listingText);
    const actualHref = card.find('a[href*="/job-detail/"]').first().attr("href") || hrefByRef.get(sourceJobId);
    const candidates = haysDetailUrlCandidates(pageUrl, jobTitle, location, sourceJobId);
    const jobUrl = actualHref
      ? absoluteUrl(actualHref, pageUrl).split("#")[0]
      : candidates[0];

    hints.set(jobUrl, {
      jobUrl,
      jobTitle,
      location,
      salary,
      postedDate,
      sourceJobId,
      listingText,
      detailUrlCandidates: candidates
    });
  });

  return [...hints.values()];
}
