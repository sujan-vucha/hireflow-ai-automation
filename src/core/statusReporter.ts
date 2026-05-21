import fs from "fs";
import path from "path";
import type { ScrapeResult, TitleExpansionReport } from "./types.js";

export function ensureOutputDirs() {
  fs.mkdirSync("output", { recursive: true });
  fs.mkdirSync(path.join("output", "status"), { recursive: true });
}

export function writeSiteStatus(result: ScrapeResult) {
  ensureOutputDirs();
  fs.writeFileSync(
    path.join("output", "status", `${result.siteId}.json`),
    JSON.stringify(result, null, 2)
  );
}

export function writeCombinedStatus(results: ScrapeResult[], timestamp: string): string {
  ensureOutputDirs();
  const outPath = path.join("output", `status-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  return outPath;
}

export function writeAIExpansionReport(report: TitleExpansionReport, timestamp: string): string {
  ensureOutputDirs();
  const outPath = path.join("output", `ai-expansion-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  return outPath;
}
