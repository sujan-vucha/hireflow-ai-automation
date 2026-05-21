import fs from "fs";
import path from "path";

export type SiteRunStatus =
  | "RUNNING"
  | "TARGET_REACHED"
  | "ALL_AVAILABLE_OR_ENDED_BELOW_TARGET"
  | "ACCESS_RESTRICTED"
  | "FAILED";

export type SiteStatusRecord = {
  siteId: string;
  siteName: string;
  target: number;
  scraped: number;
  status: SiteRunStatus;
  reason: string;
  crawler: string;
  startUrls: string[];
  startedAt: string;
  finishedAt?: string;
  notes?: string;
};

const statusDir = path.join("output", "status");

export function writeStatus(record: SiteStatusRecord) {
  fs.mkdirSync(statusDir, { recursive: true });
  const outPath = path.join(statusDir, `${record.siteId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
}

export function createInitialStatus(params: {
  siteId: string;
  siteName: string;
  target: number;
  crawler: string;
  startUrls: string[];
  notes?: string;
}): SiteStatusRecord {
  return {
    siteId: params.siteId,
    siteName: params.siteName,
    target: params.target,
    scraped: 0,
    status: "RUNNING",
    reason: "Scraper started. Public pages only. No captcha/login/paywall bypass.",
    crawler: params.crawler,
    startUrls: params.startUrls,
    startedAt: new Date().toISOString(),
    notes: params.notes
  };
}

export function finalizeStatus(record: SiteStatusRecord, params: {
  scraped: number;
  blocked: boolean;
  failedReason?: string;
}) {
  record.scraped = params.scraped;
  record.finishedAt = new Date().toISOString();

  if (params.failedReason) {
    record.status = "FAILED";
    record.reason = params.failedReason;
  } else if (params.blocked) {
    record.status = "ACCESS_RESTRICTED";
    record.reason = "Captcha, bot protection, login wall, access restriction, or similar restricted state was detected. The scraper stopped without bypassing it.";
  } else if (params.scraped >= record.target) {
    record.status = "TARGET_REACHED";
    record.reason = `Target reached: ${params.scraped}/${record.target} jobs scraped.`;
  } else {
    record.status = "ALL_AVAILABLE_OR_ENDED_BELOW_TARGET";
    record.reason = `Scraped ${params.scraped}/${record.target}. This usually means the site had fewer public jobs available, pagination ended, selectors need a site-specific adapter, or the site did not expose more public pages.`;
  }

  writeStatus(record);
}
