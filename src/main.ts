import { CheerioCrawler, PlaywrightCrawler, Dataset } from "crawlee";
import { sites } from "./sites/config.js";
import minimist from "minimist";
import { normalizeText, looksLikeJobUrl } from "./utils.js";
import { isRestrictedOrCaptchaText, shouldSkipUrl } from "./core/safety.js";
import { createInitialStatus, finalizeStatus, writeStatus } from "./core/status.js";
import { parseJsonLdJobs, mapJsonLdJob, mapFallbackJob } from "./core/normalizeJob.js";

const args = minimist(process.argv.slice(2));
const siteId = args.site;
const limit = Number(args.limit || 1000);

if (!siteId) {
  throw new Error("Please pass --site=hays, --site=randstad, etc.");
}

const site = sites.find((s) => s.id === siteId);

if (!site) {
  throw new Error(`Unknown site: ${siteId}`);
}

if (site.crawler === "api") {
  throw new Error(`Use API script for ${site.name}. Example: npm run reed`);
}

let savedCount = 0;
let blockedOrRestricted = false;
const seenUrls = new Set<string>();

const status = createInitialStatus({
  siteId: site.id,
  siteName: site.name,
  target: limit,
  crawler: site.crawler,
  startUrls: site.startUrls,
  notes: site.notes
});
writeStatus(status);

async function saveJob(data: any) {
  if (savedCount >= limit) return;
  if (!data?.jobUrl || seenUrls.has(data.jobUrl)) return;
  if (!data?.title || String(data.title).length < 3) return;

  seenUrls.add(data.jobUrl);
  savedCount += 1;
  status.scraped = savedCount;

  await Dataset.pushData({
    sourceSite: site.name,
    sourceSiteId: site.id,
    legalMode: "public-pages-only-no-captcha-login-paywall-bypass",
    ...data,
    scrapedAt: new Date().toISOString()
  });

  if (savedCount % 25 === 0) {
    writeStatus(status);
  }
}

function shouldSaveFallbackPage(url: string): boolean {
  if (site.id === "hays") {
    return new URL(url).pathname.includes("/job-detail/");
  }

  return looksLikeJobUrl(url);
}

function slugifyHaysJobTitle(title: string): string {
  return normalizeText(title)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractHaysListingDetailUrls($: any): string[] {
  const urls = new Set<string>();

  $("span#JobReference").each((_, refEl) => {
    const reference = normalizeText($(refEl).text());
    if (!reference) return;

    const card = $(refEl).closest(".mb-5");
    const title =
      normalizeText(card.find("span#JobTitle").first().text()) ||
      normalizeText(card.find("h4").first().text());
    const slug = slugifyHaysJobTitle(title);

    if (slug) {
      urls.add(`https://www.hays.co.uk/job-detail/${slug}_${reference}`);
    }
  });

  return [...urls];
}

console.log(`Starting ${site.name} with ${site.crawler} crawler. Target: ${limit}`);
console.log("Mode: public pages/API only. No captcha, login, paywall, or access-control bypass.");

try {
  if (site.crawler === "cheerio") {
    const crawler = new CheerioCrawler({
      maxRequestsPerCrawl: Math.max(limit * 4, 100),
      maxConcurrency: 2,
      requestHandlerTimeoutSecs: 60,
      sameDomainDelaySecs: 1,

      async requestHandler({ request, $, enqueueLinks, log }) {
        const url = request.loadedUrl || request.url;

        if (shouldSkipUrl(url)) return;

        const rawScripts: string[] = [];
        $('script[type="application/ld+json"]').each((_, el) => {
          rawScripts.push($(el).text());
        });

        $("script, style, noscript, template, svg").remove();

        const title =
          normalizeText($("h1").first().text()) ||
          normalizeText($('[class*="title"]').first().text()) ||
          normalizeText($('[data-testid*="title"]').first().text());

        const pageText = normalizeText($("body").text());

        if (isRestrictedOrCaptchaText(pageText)) {
          blockedOrRestricted = true;
          log.warning(`Restricted/captcha-like page detected. Stopping legal crawl for: ${url}`);
          return;
        }

        const jsonLdJobs = parseJsonLdJobs(rawScripts);

        if (jsonLdJobs.length > 0) {
          for (const job of jsonLdJobs) {
            await saveJob(mapJsonLdJob(job, url, title, pageText));
          }
        } else if (title && pageText.length > 500 && shouldSaveFallbackPage(url)) {
          await saveJob(mapFallbackJob(url, title, pageText));
        }

        if (savedCount < limit && !blockedOrRestricted) {
          if (site.id === "hays") {
            if (new URL(url).pathname.includes("/job-search")) {
              await enqueueLinks({ urls: extractHaysListingDetailUrls($).slice(0, limit - savedCount) });
            }
          } else {
            await enqueueLinks({
              selector: "a[href]",
              transformRequestFunction(req) {
                if (shouldSkipUrl(req.url)) return false;
                if (!looksLikeJobUrl(req.url)) return false;
                return req;
              }
            });
          }
        }

        log.info(`Processed: ${url}`);
      },

      failedRequestHandler({ request, log }) {
        log.warning(`Failed: ${request.url}`);
      }
    });

    await crawler.run(site.startUrls);
  }

  if (site.crawler === "playwright") {
    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: Math.max(limit * 4, 100),
      maxConcurrency: 1,
      requestHandlerTimeoutSecs: 90,
      sameDomainDelaySecs: 2,
      launchContext: {
        launchOptions: {
          headless: true
        }
      },

      async requestHandler({ request, page, enqueueLinks, log }) {
        const url = request.loadedUrl || request.url;

        if (shouldSkipUrl(url)) return;

        await page.waitForLoadState("domcontentloaded");
        await page.mouse.wheel(0, 2500).catch(() => {});
        await page.waitForTimeout(1000).catch(() => {});

        const title = normalizeText(
          await page.locator("h1").first().textContent().catch(() => "")
        );

        const bodyText = normalizeText(
          await page.locator("body").innerText().catch(() => "")
        );

        if (isRestrictedOrCaptchaText(bodyText)) {
          blockedOrRestricted = true;
          log.warning(`Restricted/captcha-like page detected. Stopping legal crawl for: ${url}`);
          return;
        }

        const rawScripts = await page.$$eval(
          'script[type="application/ld+json"]',
          (scripts) => scripts.map((script) => script.textContent || "")
        );

        const jsonLdJobs = parseJsonLdJobs(rawScripts);

        if (jsonLdJobs.length > 0) {
          for (const job of jsonLdJobs) {
            await saveJob(mapJsonLdJob(job, url, title, bodyText));
          }
        } else if (title && bodyText.length > 500 && shouldSaveFallbackPage(url)) {
          await saveJob(mapFallbackJob(url, title, bodyText));
        }

        if (savedCount < limit && !blockedOrRestricted) {
          await enqueueLinks({
            selector: "a[href]",
            transformRequestFunction(req) {
              if (shouldSkipUrl(req.url)) return false;
              if (site.id === "hays" && !new URL(req.url).pathname.includes("/job-detail/")) {
                return false;
              }
              if (!looksLikeJobUrl(req.url)) return false;
              return req;
            }
          });
        }

        log.info(`Processed: ${url}`);
      },

      failedRequestHandler({ request, log }) {
        log.warning(`Failed: ${request.url}`);
      }
    });

    await crawler.run(site.startUrls);
  }

  finalizeStatus(status, { scraped: savedCount, blocked: blockedOrRestricted });
} catch (error: any) {
  finalizeStatus(status, {
    scraped: savedCount,
    blocked: blockedOrRestricted,
    failedReason: error?.message || "Unknown failure"
  });
  throw error;
}

console.log(`Done. Saved ${savedCount} jobs.`);
console.log(`Status saved to output/status/${site.id}.json`);
console.log("Crawlee dataset is saved in storage/datasets/default.");
