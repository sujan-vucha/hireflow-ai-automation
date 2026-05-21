import "dotenv/config";
import minimist from "minimist";
import type { ScrapeInput, ScrapeResult, SiteAdapter } from "./core/types.js";
import { adapters, getAdapter } from "./config/sites.js";
import { calculateDateRange } from "./core/dateParser.js";
import { dedupeJobs } from "./core/dedupe.js";
import { writeExcelOutput, writeJsonOutput } from "./core/exportExcel.js";
import { attachLinkWarnings, validateJobLinks } from "./core/linkValidator.js";
import { scoreJobsWithLlm } from "./core/llmScorer.js";
import { logger } from "./core/logger.js";
import { readResumeText } from "./core/resumeReader.js";
import { writeAIExpansionReport, writeCombinedStatus, writeSiteStatus } from "./core/statusReporter.js";
import { expandJobTitle } from "./ai/titleExpander.js";
import { scoreSemanticRelevance } from "./ai/relevanceScorer.js";
import { matchResumeToJobs } from "./ai/resumeMatcher.js";
import { closeSharedBrowser } from "./adapters/generic.adapter.js";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no"].includes(String(value).toLowerCase());
}

function parseInput(): ScrapeInput {
  const args = minimist(process.argv.slice(2), {
    string: [
      "site",
      "title",
      "location",
      "output",
      "headless",
      "fromDate",
      "toDate",
      "resume",
      "llm",
      "scraper",
      "aiExpand",
      "strictTitle",
      "maxExpandedTitles",
      "minRelevanceScore",
      "aiProvider"
    ],
    boolean: ["all"],
    alias: {}
  });
  const title = String(args.title || "").trim();
  const location = String(args.location || "United Kingdom").trim();
  const days = Number(args.days || 7);
  const calculatedRange = calculateDateRange(days);

  if (!args.all && !args.site) {
    throw new Error("Pass --site=hays or --all.");
  }
  if (!title) {
    throw new Error('Pass --title="Digital Marketing Consultant".');
  }
  if (!Number.isFinite(days) || days < 0) {
    throw new Error("--days must be a positive number.");
  }

  return {
    site: args.site ? String(args.site) : undefined,
    all: Boolean(args.all),
    title,
    location,
    days,
    fromDate: String(args.fromDate || calculatedRange.fromDate),
    toDate: String(args.toDate || calculatedRange.toDate),
    headless: parseBool(args.headless, true),
    maxPages: args.maxPages ? Number(args.maxPages) : undefined,
    maxJobs: args.maxJobs ? Number(args.maxJobs) : undefined,
    output: args.output === "json" || args.output === "excel" ? args.output : "both",
    resume: args.resume ? String(args.resume) : undefined,
    llm: "none",
    minMatchScore: args.minMatchScore ? Number(args.minMatchScore) : undefined,
    strictKeyword: parseBool(args.strictKeyword, false),
    strictTitle: parseBool(args.strictTitle, false),
    validateUrls: parseBool(args.validateUrls, true),
    scraperProvider: args.scraper === "apify" ? "apify" : "local",
    aiExpand: parseBool(args.aiExpand ?? process.env.AI_EXPAND_DEFAULT, true),
    maxExpandedTitles: args.maxExpandedTitles ? Number(args.maxExpandedTitles) : Number(process.env.MAX_EXPANDED_TITLES || 20),
    minRelevanceScore: args.minRelevanceScore
      ? Number(args.minRelevanceScore)
      : Number(process.env.MIN_RELEVANCE_SCORE || 70),
    aiProvider: args.aiProvider === "fallback" ? "fallback" : "ollama",
    originalTitle: title
  };
}

function selectedAdapters(input: ScrapeInput): SiteAdapter[] {
  if (input.all) return adapters;
  const adapter = getAdapter(input.site || "");
  if (!adapter) {
    const known = adapters.map((item) => item.siteId).join(", ");
    throw new Error(`Unknown site "${input.site}". Known sites: ${known}`);
  }
  return [adapter];
}

function failedResult(adapter: SiteAdapter, input: ScrapeInput, error: unknown): ScrapeResult {
  return {
    siteId: adapter.siteId,
    siteName: adapter.siteName,
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
    jobs: [],
    errors: [error instanceof Error ? error.message : String(error)],
    warnings: [],
    reason: "Site failed, scraper continued to the next configured site."
  };
}

async function run() {
  const input = parseInput();
  const runId = timestamp();
  const results: ScrapeResult[] = [];
  const shouldExpand = input.aiExpand !== false && input.strictTitle !== true;
  const expansionReport = shouldExpand
    ? await expandJobTitle(input.title, input.maxExpandedTitles || 20, input.aiProvider === "fallback")
    : {
        originalTitle: input.title,
        expandedTitles: [],
        negativeTitles: [],
        providerUsed: "fallback" as const,
        fallbackAIUsed: false,
        ollamaAvailable: false
      };
  const searchTitles = [
    input.title,
    ...(shouldExpand ? expansionReport.expandedTitles.map((item) => item.title) : [])
  ].filter((title, index, titles) => title && titles.findIndex((other) => other.toLowerCase() === title.toLowerCase()) === index);
  input.expandedTitles = searchTitles;

  logger.info(
    `Starting scrape: title="${input.title}", location="${input.location}", date range ${input.fromDate} to ${input.toDate}`
  );
  logger.info(`AI expansion used: ${shouldExpand}`);
  logger.info(`AI provider used: ${expansionReport.providerUsed}`);
  logger.info(`Ollama available: ${expansionReport.ollamaAvailable}`);
  logger.info(`Search terms used (${searchTitles.length}): ${searchTitles.join(" | ")}`);
  if (input.scraperProvider === "apify") {
    logger.warn("Apify scraper provider was requested, but this run uses the local public-page adapters.");
  }

  for (const adapter of selectedAdapters(input)) {
    logger.info(`Starting site ${adapter.siteName} (${adapter.siteId})`);
    try {
      const result = await adapter.scrape(input);
      result.aiExpansionUsed = shouldExpand;
      result.aiProviderUsed = expansionReport.providerUsed;
      result.expandedTitlesCount = searchTitles.length;
      result.expandedTitles = searchTitles;
      result.fallbackAIUsed = expansionReport.fallbackAIUsed;
      result.ollamaAvailable = expansionReport.ollamaAvailable;
      results.push(result);
      writeSiteStatus(result);
      logger.info(
        `${adapter.siteName}: ${result.status}. Found ${result.totalFound}, after date filter ${result.totalAfterDateFilter}, saved ${result.totalScraped}.`
      );
      if (result.reason) logger.info(`${adapter.siteName}: ${result.reason}`);
    } catch (error) {
      const result = failedResult(adapter, input, error);
      results.push(result);
      writeSiteStatus(result);
      logger.error(`${adapter.siteName}: ${result.reason}`);
    }
  }

  const combined = dedupeJobs(results.flatMap((result) => result.jobs));
  let resumeText = "";
  if (input.resume) {
    logger.info(`Reading resume: ${input.resume}`);
    resumeText = await readResumeText(input.resume);
    logger.info(`Resume text loaded (${resumeText.length} characters).`);
  }

  const scored = await scoreJobsWithLlm(combined.jobs, input, resumeText || undefined);
  for (const warning of scored.warnings) logger.warn(warning);
  let finalJobs =
    input.minMatchScore !== undefined
      ? scored.jobs.filter((job) => job.resumeMatchScore >= Number(input.minMatchScore))
      : scored.jobs;
  if (input.minMatchScore !== undefined) {
    logger.info(`Jobs after minimum match score ${input.minMatchScore}: ${finalJobs.length}`);
  }

  if (input.validateUrls !== false) {
    logger.info("Validating public job and apply URLs before export.");
    const validated = await validateJobLinks(finalJobs);
    finalJobs = validated.jobs;
    attachLinkWarnings(results, validated.warnings);
    for (const warning of validated.warnings) logger.warn(warning.message);
    logger.info(`Jobs removed by URL validation: ${validated.removed}`);
    for (const result of results) writeSiteStatus(result);
  }

  const relevance = await scoreSemanticRelevance(finalJobs, input);
  for (const warning of relevance.warnings) logger.warn(warning);
  finalJobs = relevance.jobs;
  for (const result of results) {
    result.jobsBeforeAIScoring = relevance.jobsBeforeAIScoring;
    result.jobsAfterAIScoring = relevance.jobsAfterAIScoring;
    result.rejectedAsNotRelevant = relevance.rejectedAsNotRelevant;
    result.aiProviderUsed = relevance.providerUsed;
    result.fallbackAIUsed = relevance.fallbackAIUsed;
    result.ollamaAvailable = relevance.ollamaAvailable;
    writeSiteStatus(result);
  }
  logger.info(`Jobs before AI scoring: ${relevance.jobsBeforeAIScoring}`);
  logger.info(`Jobs after AI scoring: ${relevance.jobsAfterAIScoring}`);
  logger.info(`Rejected as not relevant: ${relevance.rejectedAsNotRelevant}`);

  const resumeMatched = await matchResumeToJobs(finalJobs, resumeText || undefined, input.aiProvider === "fallback");
  for (const warning of resumeMatched.warnings) logger.warn(warning);
  finalJobs = resumeMatched.jobs;

  const jobsJson = writeJsonOutput(finalJobs, runId);
  const aiExpansionJson = writeAIExpansionReport(expansionReport, runId);
  const statusJson = writeCombinedStatus(results, runId);
  const excelPath = writeExcelOutput(finalJobs, results, runId, expansionReport);

  logger.info(`Combined jobs before final dedupe: ${results.reduce((sum, result) => sum + result.jobs.length, 0)}`);
  logger.info(`Combined duplicates removed: ${combined.duplicatesRemoved}`);
  logger.info(`Final jobs saved: ${finalJobs.length}`);
  logger.info(`JSON output: ${jobsJson}`);
  logger.info(`AI expansion output: ${aiExpansionJson}`);
  logger.info(`Excel output: ${excelPath}`);
  logger.info(`Status output: ${statusJson}`);
}

run()
  .catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSharedBrowser();
  });
