import type { JobRecord, ScrapeResult } from "./types.js";
import { normalizeText } from "./normalize.js";

type CheckedUrl = {
  ok: boolean;
  finalUrl: string;
  statusCode: number;
  reason?: string;
};

type LinkValidationResult = {
  jobs: JobRecord[];
  warnings: Array<{ sourceSite: string; message: string }>;
  removed: number;
};

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function validHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function looksNotFoundOrClosed(text: string): boolean {
  return /\b(404|page not found|job not found|vacancy not found|no longer available|job has expired|vacancy has expired|this job has closed|this vacancy has closed|position has been filled)\b/i.test(
    text
  );
}

async function fetchForValidation(url: string, method: "GET" | "HEAD"): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUrl(url: string, inspectBody: boolean): Promise<CheckedUrl> {
  if (!validHttpUrl(url)) {
    return { ok: false, finalUrl: url, statusCode: 0, reason: "URL is missing or malformed." };
  }

  try {
    const response = await fetchForValidation(url, inspectBody ? "GET" : "HEAD");
    const statusCode = response.status;
    const finalUrl = response.url || url;

    if (statusCode >= 400) {
      return { ok: false, finalUrl, statusCode, reason: `HTTP ${statusCode}` };
    }

    if (inspectBody) {
      const contentType = response.headers.get("content-type") || "";
      if (/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
        const text = normalizeText((await response.text()).slice(0, 50000));
        if (looksNotFoundOrClosed(text)) {
          return { ok: false, finalUrl, statusCode, reason: "Page text indicates not found, closed, or expired." };
        }
      }
    }

    return { ok: true, finalUrl, statusCode };
  } catch (error) {
    if (!inspectBody) {
      try {
        return await checkUrl(url, true);
      } catch {
        // Fall through to the original error below.
      }
    }
    return {
      ok: false,
      finalUrl: url,
      statusCode: 0,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

export function attachLinkWarnings(results: ScrapeResult[], warnings: LinkValidationResult["warnings"]) {
  for (const warning of warnings) {
    const result = results.find((item) => item.siteName === warning.sourceSite || item.siteId === warning.sourceSite);
    if (result) result.warnings.push(warning.message);
  }
}

export async function validateJobLinks(jobs: JobRecord[], concurrency = 4): Promise<LinkValidationResult> {
  const warnings: LinkValidationResult["warnings"] = [];
  const kept: Array<JobRecord | undefined> = [];
  let removed = 0;

  async function validate(job: JobRecord, index: number) {
    const jobCheck = await checkUrl(job.jobUrl, true);
    if (!jobCheck.ok) {
      removed += 1;
      warnings.push({
        sourceSite: job.sourceSite,
        message: `${job.jobUrl || job.jobTitle}: removed because job URL failed validation (${jobCheck.reason || "unknown"}).`
      });
      return;
    }

    const nextJob = { ...job, jobUrl: jobCheck.finalUrl };
    if (!validHttpUrl(nextJob.applyUrl)) {
      nextJob.applyUrl = nextJob.jobUrl;
    } else if (nextJob.applyUrl !== nextJob.jobUrl) {
      const applyCheck = await checkUrl(nextJob.applyUrl, false);
      if (!applyCheck.ok) {
        warnings.push({
          sourceSite: job.sourceSite,
          message: `${job.applyUrl}: apply URL failed validation (${applyCheck.reason || "unknown"}); using job URL instead.`
        });
        nextJob.applyUrl = nextJob.jobUrl;
      } else {
        nextJob.applyUrl = applyCheck.finalUrl;
      }
    }

    kept[index] = nextJob;
  }

  for (let index = 0; index < jobs.length; index += concurrency) {
    await Promise.all(jobs.slice(index, index + concurrency).map((job, offset) => validate(job, index + offset)));
  }

  return { jobs: kept.filter((job): job is JobRecord => Boolean(job)), warnings, removed };
}
