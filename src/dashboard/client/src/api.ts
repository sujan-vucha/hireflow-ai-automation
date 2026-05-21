import type { DeleteJobsResponse, RunFile, RunPayload, ScrapeForm, ScrapeState, SiteOption } from "./types.js";

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON from ${url}, received ${contentType || "unknown content type"}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `Request failed with HTTP ${response.status}`);
  }
  return body as T;
}

export function getRuns(): Promise<RunFile[]> {
  return jsonRequest<RunFile[]>("/api/runs");
}

export function getRun(runId: string): Promise<RunPayload> {
  return jsonRequest<RunPayload>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function getLatestRun(): Promise<RunPayload> {
  return jsonRequest<RunPayload>("/api/runs/latest");
}

export function getSites(): Promise<SiteOption[]> {
  return jsonRequest<SiteOption[]>("/api/sites");
}

export function getScrapeState(): Promise<ScrapeState> {
  return jsonRequest<ScrapeState>("/api/scrape/current");
}

export function startScrape(form: ScrapeForm): Promise<ScrapeState> {
  const body: Record<string, unknown> = {
    all: form.mode === "all",
    site: form.mode === "site" ? form.site : undefined,
    title: form.title,
    location: form.location,
    days: Number(form.days || 7),
    headless: form.headless,
    strictKeyword: form.strictKeyword,
    strictTitle: form.strictTitle,
    validateUrls: form.validateUrls,
    aiExpand: form.aiExpand
  };

  if (form.maxPages) body.maxPages = Number(form.maxPages);
  if (form.maxJobs) body.maxJobs = Number(form.maxJobs);
  if (form.resume) body.resume = form.resume;
  if (form.minMatchScore) body.minMatchScore = Number(form.minMatchScore);
  if (form.maxExpandedTitles) body.maxExpandedTitles = Number(form.maxExpandedTitles);
  if (form.minRelevanceScore) body.minRelevanceScore = Number(form.minRelevanceScore);

  return jsonRequest<ScrapeState>("/api/scrape/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function stopScrape(): Promise<ScrapeState> {
  return jsonRequest<ScrapeState>("/api/scrape/stop", { method: "POST" });
}

export function uploadResume(file: File): Promise<{ path: string; filename: string; size: number }> {
  const body = new FormData();
  body.append("resume", file);
  return jsonRequest<{ path: string; filename: string; size: number }>("/api/resume/upload", {
    method: "POST",
    body
  });
}

export function deleteRunJobs(runId: string, keys: string[]): Promise<DeleteJobsResponse> {
  return jsonRequest<DeleteJobsResponse>(`/api/runs/${encodeURIComponent(runId)}/jobs`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys })
  });
}

export function deleteAllRunJobs(runId: string): Promise<DeleteJobsResponse> {
  return jsonRequest<DeleteJobsResponse>(`/api/runs/${encodeURIComponent(runId)}/jobs`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ all: true })
  });
}
