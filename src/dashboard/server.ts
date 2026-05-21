import fs from "fs";
import http from "http";
import path from "path";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { fileURLToPath } from "url";
import { adapters } from "../config/sites.js";
import { writeExcelOutput } from "../core/exportExcel.js";

type RunFile = {
  runId: string;
  createdAt: string;
  jobsPath: string;
  statusPath: string;
  excelPath: string;
  jobCount: number;
  siteCount: number;
  hasExcel: boolean;
};

type CountRow = {
  label: string;
  count: number;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = process.cwd();
const outputDir = path.join(workspaceDir, "output");
const uploadsDir = path.join(workspaceDir, "storage", "uploads");
const builtClientDir = path.join(__dirname, "dist");
const publicDir = fs.existsSync(builtClientDir) ? builtClientDir : path.join(__dirname, "public");

type ScrapeRunState = {
  id: string;
  status: "idle" | "running" | "completed" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  command: string[];
  pid?: number;
  exitCode?: number | null;
  logs: string[];
  latestRunId?: string;
  error?: string;
};

let activeScrape: ChildProcessWithoutNullStreams | null = null;
let scrapeState: ScrapeRunState = {
  id: "",
  status: "idle",
  startedAt: "",
  command: [],
  logs: []
};

const siteStrategies: Record<string, string> = {
  hays: "Playwright rendered Hays search pages with Hays-specific detail extraction.",
  cvlibrary: "Public search pages with Playwright detail fallback.",
  michaelpage: "Playwright detail extraction with Michael Page summary/contact sections.",
  reed: "Official Reed API when REED_API_KEY is configured.",
  randstad: "Cheerio first with Playwright fallback for public job details.",
  robertwalters: "Public pages/API discovery where accessible; records CAPTCHA/restriction status.",
  adecco: "Playwright and public network discovery path.",
  manpower: "Playwright detail extraction for Manpower job metadata.",
  roberthalf: "Playwright detail extraction for Robert Half reference/staffing fields.",
  pageexecutive: "Playwright public page extraction for executive roles.",
  kornferry: "Playwright plus public network discovery path.",
  tiger: "Cheerio first with Playwright fallback; records geo/security restrictions.",
  morganhunt: "Cheerio with Morgan Hunt custom consultant/detail extraction.",
  huntress: "Cheerio first with Playwright fallback.",
  jac: "Playwright with JAC-specific detail fields.",
  propel: "Cheerio first with Playwright fallback."
};

function argValue(name: string, fallback: string): string {
  const prefixed = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefixed));
  if (direct) return direct.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return process.env[`DASHBOARD_${name.toUpperCase()}`] || fallback;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function sanitizeLog(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n");
}

function appendLog(value: string) {
  const clean = sanitizeLog(value);
  if (!clean) return;
  for (const line of clean.split(/\n+/)) {
    scrapeState.logs.push(line);
  }
  scrapeState.logs = scrapeState.logs.slice(-600);
}

function markStaleScrapeIfNeeded() {
  if (scrapeState.status === "running" && !activeScrape) {
    scrapeState.status = "failed";
    scrapeState.finishedAt = scrapeState.finishedAt || new Date().toISOString();
    scrapeState.error = scrapeState.error || "Scrape process is not attached. It likely exited before reporting completion.";
    appendLog(scrapeState.error);
  }
}

function killProcessTree(pid: number) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  process.kill(pid, "SIGTERM");
}

function readRequestBody(request: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function timestampFromRunId(runId: string): string {
  const normalized = runId.replace(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1-$2-$3T$4:$5:$6.$7Z"
  );
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? runId : date.toISOString();
}

function listRuns(): RunFile[] {
  if (!fs.existsSync(outputDir)) return [];

  const files = fs.readdirSync(outputDir);
  const runIds = files
    .map((file) => file.match(/^jobs-(.+)\.json$/)?.[1] || "")
    .filter(Boolean);

  return runIds
    .map((runId) => {
      const jobsPath = path.join(outputDir, `jobs-${runId}.json`);
      const statusPath = path.join(outputDir, `status-${runId}.json`);
      const excelPath = path.join(outputDir, `jobs-${runId}.xlsx`);
      const jobs = readJson<any[]>(jobsPath, []);
      const status = readJson<any[]>(statusPath, []);

      return {
        runId,
        createdAt: timestampFromRunId(runId),
        jobsPath,
        statusPath,
        excelPath,
        jobCount: Array.isArray(jobs) ? jobs.length : 0,
        siteCount: Array.isArray(status) ? status.length : 0,
        hasExcel: fs.existsSync(excelPath)
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function countBy<T>(items: T[], pick: (item: T) => string): CountRow[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = pick(item) || "Not publicly available";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function isMissing(value: unknown): boolean {
  return !value || String(value).trim() === "" || String(value).trim() === "Not publicly available";
}

function scoreOf(job: any): number {
  return Number(job.semanticRelevanceScore || job.resumeMatchScore || job.roleMatchScore || 0);
}

function jobKey(job: any): string {
  return job.jobUrl || `${job.sourceSite}:${job.sourceJobId}:${job.jobTitle}`;
}

function analyze(jobs: any[], status: any[]) {
  const scores = jobs.map(scoreOf).filter((score) => score > 0);
  const confidence = jobs.map((job) => Number(job.extractionConfidence || 0) * 100).filter((score) => score > 0);
  const errors = status.flatMap((site) =>
    (site.errors || []).map((message: string) => ({
      siteId: site.siteId,
      siteName: site.siteName,
      message
    }))
  );
  const warnings = status.flatMap((site) =>
    (site.warnings || []).map((message: string) => ({
      siteId: site.siteId,
      siteName: site.siteName,
      message
    }))
  );

  const scoreBuckets = [
    { label: "90-100", count: jobs.filter((job) => scoreOf(job) >= 90).length },
    { label: "70-89", count: jobs.filter((job) => scoreOf(job) >= 70 && scoreOf(job) < 90).length },
    { label: "50-69", count: jobs.filter((job) => scoreOf(job) >= 50 && scoreOf(job) < 70).length },
    { label: "1-49", count: jobs.filter((job) => scoreOf(job) > 0 && scoreOf(job) < 50).length },
    { label: "Unscored", count: jobs.filter((job) => scoreOf(job) === 0).length }
  ];

  return {
    summary: {
      totalJobs: jobs.length,
      jobsAfterDateFilter: status.reduce((sum, site) => sum + Number(site.totalAfterDateFilter || 0), 0),
      jobsAfterRelevanceFilter: status.reduce((sum, site) => sum + Number(site.jobsAfterAIScoring || site.totalScraped || 0), 0),
      duplicatesRemoved: status.reduce((sum, site) => sum + Number(site.totalDuplicatesRemoved || 0), 0),
      totalSites: new Set(status.map((site) => site.siteId).filter(Boolean)).size,
      publicEmails: jobs.filter((job) => !isMissing(job.recruiterEmail)).length,
      missingRecruiter: jobs.filter((job) => isMissing(job.recruiterName)).length,
      missingEmail: jobs.filter((job) => isMissing(job.recruiterEmail)).length,
      missingSalary: jobs.filter((job) => isMissing(job.salary)).length,
      sitesSuccessful: status.filter((site) => String(site.status || "").includes("SUCCESS") || site.status === "ALL_AVAILABLE_SCRAPED").length,
      sitesWithWarnings: status.filter((site) => (site.warnings || []).length > 0 || String(site.status || "").includes("WARNING")).length,
      sitesWithNoMatchingJobs: status.filter((site) => site.status === "NO_MATCHING_JOBS" || site.status === "LOW_INVENTORY").length,
      averageMatchScore: average(scores),
      averageExtractionConfidence: average(confidence),
      highConfidenceJobs: jobs.filter((job) => Number(job.extractionConfidence || 0) >= 0.8).length,
      errorCount: errors.length,
      warningCount: warnings.length
    },
    statusCounts: countBy(status, (site) => site.status),
    sourceCounts: countBy(jobs, (job) => job.sourceSite),
    locationCounts: countBy(jobs, (job) => job.location).slice(0, 12),
    contractCounts: countBy(jobs, (job) => job.contractType || job.jobType).slice(0, 12),
    recruiterCounts: countBy(jobs, (job) => job.recruiterName).slice(0, 12),
    skillCounts: countBy(
      jobs.flatMap((job) => job.keySkills || []),
      (skill) => skill
    ).slice(0, 15),
    postedDateCounts: countBy(jobs, (job) => job.postedDate).slice(0, 20),
    scoreBuckets,
    siteStatus: status.map((site) => ({
      siteId: site.siteId,
      siteName: site.siteName,
      status: site.status,
      found: site.totalFound || 0,
      scraped: site.totalScraped || 0,
      afterDateFilter: site.totalAfterDateFilter || 0,
      duplicatesRemoved: site.totalDuplicatesRemoved || 0,
      pagesChecked: site.pagesChecked || 0,
      jobCardsFound: site.jobCardsFound || site.totalFound || 0,
      detailPagesOpened: site.detailPagesOpened || 0,
      jobsSaved: site.jobsSaved || site.totalScraped || 0,
      jobsFilteredByDate: site.jobsFilteredByDate || 0,
      jobsFilteredByRelevance: site.jobsFilteredByRelevance || site.rejectedAsNotRelevant || 0,
      reason: site.reason || "",
      errors: site.errors || [],
      warnings: site.warnings || []
    })),
    errors,
    warnings,
    aiExpansion: []
  };
}

function runPayload(runId: string) {
  const run = listRuns().find((item) => item.runId === runId);
  if (!run) return null;

  const jobs = readJson<any[]>(run.jobsPath, []);
  const status = readJson<any[]>(run.statusPath, []);
  const expansion = readJson<any>(path.join(outputDir, `ai-expansion-${runId}.json`), null);
  const analytics = analyze(jobs, status);
  analytics.aiExpansion = expansion
    ? [
        {
          originalTitle: expansion.originalTitle,
          title: expansion.originalTitle,
          category: "Original",
          priority: 0,
          reason: "Original user search title.",
          providerUsed: expansion.providerUsed
        },
        ...(expansion.expandedTitles || []).map((item: any) => ({
          originalTitle: expansion.originalTitle,
          title: item.title,
          category: item.category,
          priority: item.priority,
          reason: item.reason,
          providerUsed: expansion.providerUsed
        }))
      ]
    : [];
  return {
    run,
    jobs,
    status,
    analytics
  };
}

function deleteRunJobs(runId: string, input: any) {
  const run = listRuns().find((item) => item.runId === runId);
  if (!run) throw new Error("Run not found.");

  const jobs = readJson<any[]>(run.jobsPath, []);
  const status = readJson<any[]>(run.statusPath, []);
  const keys = new Set((Array.isArray(input.keys) ? input.keys : []).map(String));
  const deleteAll = input.all === true;

  if (!deleteAll && keys.size === 0) {
    throw new Error("Choose at least one job to delete.");
  }

  const keptJobs = deleteAll ? [] : jobs.filter((job) => !keys.has(jobKey(job)));
  const deletedCount = jobs.length - keptJobs.length;

  fs.writeFileSync(run.jobsPath, JSON.stringify(keptJobs, null, 2));
  if (fs.existsSync(run.excelPath)) {
    writeExcelOutput(keptJobs, status as any[], runId);
  }

  return {
    deletedCount,
    payload: runPayload(runId)
  };
}

function sendJson(response: http.ServerResponse, body: unknown, statusCode = 200) {
  const json = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(json);
}

function sendText(response: http.ServerResponse, body: string, statusCode = 200) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

function safeUploadName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, ext).replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").slice(0, 80) || "resume";
  return `${base}-${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`;
}

function parseMultipartUpload(body: Buffer, contentType: string): { filename: string; data: Buffer } {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error("Missing upload boundary.");

  const raw = body.toString("binary");
  const parts = raw.split(`--${boundary}`);
  const filePart = parts.find((part) => /name="resume"/i.test(part) && /filename="/i.test(part));
  if (!filePart) throw new Error("Resume file field is missing.");

  const [headerText, ...rest] = filePart.split("\r\n\r\n");
  const filename = headerText.match(/filename="([^"]+)"/i)?.[1] || "resume";
  const fileBinary = rest.join("\r\n\r\n").replace(/\r\n$/, "");
  return {
    filename,
    data: Buffer.from(fileBinary, "binary")
  };
}

function readRequestBuffer(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    request.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      length += buffer.length;
      if (length > 15_000_000) {
        request.destroy();
        reject(new Error("Upload too large. Maximum supported size is 15 MB."));
      }
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function staticMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  return map[ext] || "application/octet-stream";
}

function sendFile(response: http.ServerResponse, filePath: string, downloadName?: string) {
  if (!fs.existsSync(filePath)) {
    sendText(response, "Not found", 404);
    return;
  }

  const headers: Record<string, string> = {
    "content-type": staticMime(filePath)
  };
  if (downloadName) {
    headers["content-disposition"] = `attachment; filename="${downloadName}"`;
  }
  response.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(response);
}

function safeStaticPath(urlPath: string): string {
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const fullPath = path.normalize(path.join(publicDir, requested));
  if (!fullPath.startsWith(publicDir)) return path.join(publicDir, "index.html");
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) return fullPath;
  return path.join(publicDir, "index.html");
}

function boolArg(value: unknown): string {
  if (value === true || value === "true" || value === "1") return "true";
  return "false";
}

function pushOptional(args: string[], name: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  args.push(`--${name}=${String(value)}`);
}

function scrapeArgs(input: any): string[] {
  const args: string[] = [];
  if (input.all) {
    args.push("--all");
  } else if (input.site) {
    args.push(`--site=${String(input.site)}`);
  } else {
    throw new Error("Choose one site or all sites.");
  }

  if (!String(input.title || "").trim()) {
    throw new Error("Job title is required.");
  }

  args.push(`--title=${String(input.title).trim()}`);
  pushOptional(args, "location", input.location || "United Kingdom");
  pushOptional(args, "days", input.days || 7);
  pushOptional(args, "headless", boolArg(input.headless ?? true));
  pushOptional(args, "maxPages", input.maxPages);
  pushOptional(args, "maxJobs", input.maxJobs);
  pushOptional(args, "resume", input.resume);
  pushOptional(args, "llm", input.llm);
  pushOptional(args, "minMatchScore", input.minMatchScore);
  pushOptional(args, "strictKeyword", boolArg(input.strictKeyword ?? false));
  pushOptional(args, "strictTitle", boolArg(input.strictTitle ?? true));
  pushOptional(args, "validateUrls", boolArg(input.validateUrls ?? true));
  pushOptional(args, "aiExpand", boolArg(input.aiExpand ?? true));
  pushOptional(args, "maxExpandedTitles", input.maxExpandedTitles);
  pushOptional(args, "minRelevanceScore", input.minRelevanceScore);
  return args;
}

function startScrape(input: any) {
  if (activeScrape && scrapeState.status === "running") {
    throw new Error("A scrape is already running.");
  }

  const args = scrapeArgs(input);
  const nodeCommand = process.execPath;
  const tsxCli = path.join(workspaceDir, "node_modules", "tsx", "dist", "cli.mjs");
  const scrapeScript = path.join(workspaceDir, "src", "scrape.ts");
  const command = [nodeCommand, tsxCli, scrapeScript, ...args];
  const beforeLatest = listRuns()[0]?.runId;

  scrapeState = {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    status: "running",
    startedAt: new Date().toISOString(),
    command,
    pid: undefined,
    logs: []
  };
  appendLog(`Starting scrape: ${command.join(" ")}`);

  try {
    activeScrape = spawn(nodeCommand, [tsxCli, scrapeScript, ...args], {
      cwd: workspaceDir,
      env: process.env,
      windowsHide: true
    });
    scrapeState.pid = activeScrape.pid;
  } catch (error) {
    scrapeState.status = "failed";
    scrapeState.finishedAt = new Date().toISOString();
    scrapeState.error = error instanceof Error ? error.message : String(error);
    appendLog(scrapeState.error);
    activeScrape = null;
    throw error;
  }

  activeScrape.stdout.on("data", (data) => appendLog(String(data)));
  activeScrape.stderr.on("data", (data) => appendLog(String(data)));
  activeScrape.on("error", (error) => {
    scrapeState.status = "failed";
    scrapeState.error = error.message;
    scrapeState.finishedAt = new Date().toISOString();
    appendLog(error.message);
    activeScrape = null;
  });
  activeScrape.on("close", (code) => {
    const latest = listRuns()[0]?.runId;
    scrapeState.status = scrapeState.status === "stopped" ? "stopped" : code === 0 ? "completed" : "failed";
    scrapeState.exitCode = code;
    scrapeState.finishedAt = new Date().toISOString();
    scrapeState.latestRunId = latest && latest !== beforeLatest ? latest : latest;
    appendLog(`Scrape finished with exit code ${code}.`);
    activeScrape = null;
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", "http://localhost");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/api/sites") {
    sendJson(
      response,
      adapters.map((adapter) => ({
        siteId: adapter.siteId,
        siteName: adapter.siteName,
        baseUrl: adapter.baseUrl,
        supportsApi: adapter.supportsApi,
        strategy: siteStrategies[adapter.siteId] || "Site-specific public page adapter."
      }))
    );
    return;
  }

  if (pathname === "/api/runs") {
    sendJson(response, listRuns().map(({ jobsPath, statusPath, excelPath, ...run }) => run));
    return;
  }

  if (pathname === "/api/runs/latest") {
    const latest = listRuns()[0];
    if (!latest) {
      sendJson(response, { run: null, jobs: [], status: [], analytics: analyze([], []) });
      return;
    }
    sendJson(response, runPayload(latest.runId));
    return;
  }

  const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch) {
    const payload = runPayload(runMatch[1]);
    if (!payload) {
      sendJson(response, { error: "Run not found" }, 404);
      return;
    }
    sendJson(response, payload);
    return;
  }

  const deleteJobsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/jobs$/);
  if (deleteJobsMatch && request.method === "DELETE") {
    try {
      const body = await readRequestBody(request);
      sendJson(response, deleteRunJobs(deleteJobsMatch[1], body));
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return;
  }

  const downloadMatch = pathname.match(/^\/api\/download\/([^/]+)\/(excel|jobs|status)$/);
  if (downloadMatch) {
    const run = listRuns().find((item) => item.runId === downloadMatch[1]);
    if (!run) {
      sendText(response, "Run not found", 404);
      return;
    }

    const type = downloadMatch[2];
    if (type === "excel") sendFile(response, run.excelPath, `jobs-${run.runId}.xlsx`);
    if (type === "jobs") sendFile(response, run.jobsPath, `jobs-${run.runId}.json`);
    if (type === "status") sendFile(response, run.statusPath, `status-${run.runId}.json`);
    return;
  }

  if (pathname === "/api/scrape/current") {
    markStaleScrapeIfNeeded();
    sendJson(response, scrapeState);
    return;
  }

  if (pathname === "/api/scrape/start" && request.method === "POST") {
    try {
      const body = await readRequestBody(request);
      startScrape(body);
      sendJson(response, scrapeState, 202);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return;
  }

  if (pathname === "/api/scrape/stop" && request.method === "POST") {
    if (activeScrape?.pid) {
      const pid = activeScrape.pid;
      scrapeState.status = "stopped";
      scrapeState.finishedAt = new Date().toISOString();
      appendLog(`Stop requested from dashboard. Killing process tree ${pid}.`);
      try {
        killProcessTree(pid);
      } catch (error) {
        appendLog(`Stop warning: ${error instanceof Error ? error.message : String(error)}`);
        activeScrape.kill("SIGTERM");
      }
      activeScrape = null;
    } else if (scrapeState.status === "running") {
      scrapeState.status = "stopped";
      scrapeState.finishedAt = new Date().toISOString();
      scrapeState.error = "Cleared stale running state. No active scrape process was attached.";
      appendLog(scrapeState.error);
    }
    sendJson(response, scrapeState);
    return;
  }

  if (pathname === "/api/resume/upload" && request.method === "POST") {
    try {
      const contentType = request.headers["content-type"] || "";
      if (!String(contentType).includes("multipart/form-data")) {
        throw new Error("Use multipart/form-data with a resume file.");
      }
      const body = await readRequestBuffer(request);
      const upload = parseMultipartUpload(body, String(contentType));
      const ext = path.extname(upload.filename).toLowerCase();
      if (![".pdf", ".txt", ".md", ".json"].includes(ext)) {
        throw new Error("Supported resume formats: PDF, TXT, MD, JSON.");
      }
      fs.mkdirSync(uploadsDir, { recursive: true });
      const filename = safeUploadName(upload.filename);
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, upload.data);
      sendJson(response, { path: filePath, filename, size: upload.data.length });
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, { error: "API route not found" }, 404);
    return;
  }

  sendFile(response, safeStaticPath(pathname));
});

const port = Number(argValue("port", "4317"));
const host = argValue("host", "127.0.0.1");

server.listen(port, host, () => {
  console.log(`Dashboard running at http://${host}:${port}`);
});
