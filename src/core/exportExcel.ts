import fs from "fs";
import path from "path";
import xlsx from "xlsx";
import type { JobRecord, ScrapeResult, TitleExpansionReport } from "./types.js";
import { keywordMatchScore } from "./normalize.js";

const EXCEL_CELL_LIMIT = 32000;

function excelText(value: unknown): string {
  const text = String(value ?? "");
  return text.length > EXCEL_CELL_LIMIT ? `${text.slice(0, EXCEL_CELL_LIMIT)}... [truncated for Excel]` : text;
}

function roleMatchPercent(job: JobRecord): number {
  return job.resumeMatchScore || job.roleMatchScore || Math.round(keywordMatchScore(job, job.matchKeyword) * 100);
}

function jobRow(job: JobRecord) {
  return {
    "Source Site": job.sourceSite,
    "Job Title": job.jobTitle,
    "Company": job.company,
    "Agency": job.agency,
    "Division / Specialism": job.jobFunction || job.sector || job.siteSpecificFields?.haysSpecialism || "",
    "Location": job.location,
    "Salary": job.salary,
    "Work Type": job.jobType,
    "Contract Type": job.contractType,
    "Work Pattern": job.workPattern,
    "Posted Date": job.postedDate,
    "Closing Date": job.closingDate,
    "Recruiter Name": job.recruiterName,
    "Recruiter Email": job.recruiterEmail,
    "Recruiter Phone": job.recruiterPhone,
    "Apply URL": job.applyUrl,
    "Job URL": job.jobUrl,
    "Job Code": job.sourceJobId,
    "Application Status": job.applicationStatus || "Pending",
    "Original Search Title": job.originalSearchTitle,
    "Matched Search Title": job.matchedSearchTitle,
    "AI Expanded Title Used": job.aiExpandedTitleUsed ? "Yes" : "No",
    "AI Provider Used": job.aiProviderUsed,
    "AI Mode": job.aiMode,
    "Role Category": job.roleCategory,
    "Semantic Relevance Score": job.semanticRelevanceScore,
    "Semantic Match Type": job.semanticMatchType,
    "Semantic Match Reason": excelText(job.semanticMatchReason),
    "Resume Match Score": roleMatchPercent(job),
    "Key Matching Skills": (job.keyMatchingSkills?.length ? job.keyMatchingSkills : job.keySkills).join(", "),
    "Why Strong Fit": excelText(job.whyStrongFit || job.semanticMatchReason),
    "Missing Fields": job.missingFields.join(", "),
    "Extraction Confidence": job.extractionConfidence,
    "Scraped At": job.scrapedAt,
    "Description": excelText(job.description),
    "Currency": job.currency,
    "Source Job ID": job.sourceJobId,
    "Recruiter Email Source": job.recruiterEmailSource,
    "Recruiter Email Pattern": job.recruiterEmailPattern,
    "Match Gaps": job.matchGaps.join(", "),
    "Site Specific Fields": excelText(JSON.stringify(job.siteSpecificFields || {}))
  };
}

function statusRow(result: ScrapeResult) {
  return {
    "Site ID": result.siteId,
    "Site Name": result.siteName,
    "Status": result.status,
    "Keyword": result.targetKeyword,
    "Location": result.location,
    "Days": result.days,
    "From Date": result.fromDate,
    "To Date": result.toDate,
    "Pages Checked": result.pagesChecked || 0,
    "Job Cards Found": result.jobCardsFound || result.totalFound,
    "Detail Pages Opened": result.detailPagesOpened || 0,
    "Jobs Saved": result.jobsSaved || result.totalScraped,
    "Jobs Filtered By Date": result.jobsFilteredByDate || 0,
    "Jobs Filtered By Relevance": result.jobsFilteredByRelevance || result.rejectedAsNotRelevant || 0,
    "Total Found": result.totalFound,
    "Total Scraped": result.totalScraped,
    "After Date Filter": result.totalAfterDateFilter,
    "Duplicates Removed": result.totalDuplicatesRemoved,
    "AI Expansion Used": result.aiExpansionUsed ? "Yes" : "No",
    "AI Provider Used": result.aiProviderUsed || "",
    "Expanded Titles Count": result.expandedTitlesCount || 0,
    "Expanded Titles": (result.expandedTitles || []).join(" | "),
    "Jobs Before AI Scoring": result.jobsBeforeAIScoring || 0,
    "Jobs After AI Scoring": result.jobsAfterAIScoring || 0,
    "Rejected As Not Relevant": result.rejectedAsNotRelevant || 0,
    "Fallback AI Used": result.fallbackAIUsed ? "Yes" : "No",
    "Ollama Available": result.ollamaAvailable ? "Yes" : "No",
    "Reason": result.reason,
    "Warnings": excelText(result.warnings.join(" | ")),
    "Errors": excelText(result.errors.join(" | "))
  };
}

export function writeJsonOutput(jobs: JobRecord[], timestamp: string): string {
  fs.mkdirSync("output", { recursive: true });
  const outPath = path.join("output", `jobs-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(jobs, null, 2));
  return outPath;
}

function aiExpansionRows(report?: TitleExpansionReport) {
  if (!report) return [];
  return [
    {
      "Original Title": report.originalTitle,
      "Expanded Title": report.originalTitle,
      "Category": "Original",
      "Priority": 0,
      "Reason": "Original user search title.",
      "Provider Used": report.providerUsed
    },
    ...report.expandedTitles.map((item) => ({
      "Original Title": report.originalTitle,
      "Expanded Title": item.title,
      "Category": item.category,
      "Priority": item.priority,
      "Reason": excelText(item.reason),
      "Provider Used": report.providerUsed
    }))
  ];
}

export function writeExcelOutput(
  jobs: JobRecord[],
  results: ScrapeResult[],
  timestamp: string,
  expansionReport?: TitleExpansionReport
): string {
  fs.mkdirSync("output", { recursive: true });
  const workbook = xlsx.utils.book_new();

  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(jobs.map(jobRow)), "All Jobs");
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.json_to_sheet(jobs.filter((job) => Number(job.semanticRelevanceScore || 0) >= 80).map(jobRow)),
    "High Relevance Jobs"
  );
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.json_to_sheet(
      jobs.filter((job) => job.missingFields.includes("recruiterName") || job.missingFields.includes("recruiterEmail")).map(jobRow)
    ),
    "Missing Recruiter"
  );
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.json_to_sheet(jobs.filter((job) => job.missingFields.includes("salary") || !job.salary).map(jobRow)),
    "Missing Salary"
  );
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(aiExpansionRows(expansionReport)), "AI Expansion Report");
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(results.map(statusRow)), "Site Status");
  xlsx.utils.book_append_sheet(
    workbook,
    xlsx.utils.json_to_sheet(
      results.flatMap((result) =>
        result.errors.map((error) => ({
          "Site ID": result.siteId,
          "Site Name": result.siteName,
          "Error": excelText(error)
        }))
      )
    ),
    "Errors"
  );

  const outPath = path.join("output", `jobs-${timestamp}.xlsx`);
  xlsx.writeFile(workbook, outPath);
  return outPath;
}
