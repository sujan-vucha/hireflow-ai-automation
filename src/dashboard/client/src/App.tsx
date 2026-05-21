import {
  Activity,
  BarChart3,
  CheckCircle2,
  CircleStop,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  Loader2,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { deleteAllRunJobs, deleteRunJobs, getRun, getRuns, getScrapeState, getSites, startScrape, stopScrape, uploadResume } from "./api.js";
import type { Analytics, CountRow, JobRecord, RunFile, RunPayload, ScrapeForm, ScrapeState, SiteOption } from "./types.js";
import "./styles.css";

const defaultForm: ScrapeForm = {
  mode: "all",
  site: "hays",
  title: "Digital Marketing Consultant / Growth Strategy / Analytics / Performance Media",
  location: "United Kingdom",
  days: "90",
  maxPages: "",
  maxJobs: "",
  resume: "C:\\Users\\shrut\\Downloads\\Prashant_Kumar_ATS_Resume_Digital.pdf",
  minMatchScore: "",
  headless: true,
  strictKeyword: false,
  strictTitle: false,
  validateUrls: true,
  aiExpand: true,
  maxExpandedTitles: "20",
  minRelevanceScore: "70"
};

type Filters = {
  query: string;
  site: string;
  status: string;
  minScore: string;
  matchedTitle: string;
  location: string;
  fromDate: string;
  toDate: string;
  minResumeScore: string;
  missingRecruiter: boolean;
  missingSalary: boolean;
  duplicateRemoved: boolean;
  sortBy: "postedDate" | "relevance" | "resume" | "website";
};

const defaultFilters: Filters = {
  query: "",
  site: "",
  status: "",
  minScore: "",
  matchedTitle: "",
  location: "",
  fromDate: "",
  toDate: "",
  minResumeScore: "",
  missingRecruiter: false,
  missingSalary: false,
  duplicateRemoved: false,
  sortBy: "relevance"
};

function isMissing(value: unknown): boolean {
  return !value || String(value).trim() === "" || String(value).trim() === "Not publicly available";
}

function scoreOf(job: JobRecord): number {
  return Number(job.semanticRelevanceScore || job.resumeMatchScore || job.roleMatchScore || 0);
}

function applicationStatusOf(job: JobRecord, statuses: Record<string, string>): string {
  return statuses[jobKey(job)] || job.applicationStatus || "Pending";
}

function jobKey(job: JobRecord): string {
  return job.jobUrl || `${job.sourceSite}:${job.sourceJobId}:${job.jobTitle}`;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined
  });
}

function downloadUrl(runId: string, type: "excel" | "jobs" | "status"): string {
  return `/api/download/${encodeURIComponent(runId)}/${type}`;
}

function statusClass(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes("success") || lower === "completed") return "good";
  if (lower.includes("warning") || lower.includes("partial") || lower.includes("running")) return "warn";
  if (lower.includes("error") || lower.includes("blocked") || lower.includes("captcha") || lower.includes("failed")) {
    return "bad";
  }
  return "";
}

function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Bars({ rows }: { rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  if (!rows.length) return <div className="empty-inline">No data</div>;

  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar-row" key={row.label} title={row.label}>
          <span>{row.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} />
          </div>
          <b>{row.count}</b>
        </div>
      ))}
    </div>
  );
}

function ScrapePanel({
  form,
  setForm,
  sites,
  scrapeState,
  onStart,
  onStop,
  onUploadResume
}: {
  form: ScrapeForm;
  setForm: (form: ScrapeForm) => void;
  sites: SiteOption[];
  scrapeState: ScrapeState | null;
  onStart: () => void;
  onStop: () => void;
  onUploadResume: (file: File) => void;
}) {
  const running = scrapeState?.status === "running";
  const set = <K extends keyof ScrapeForm>(key: K, value: ScrapeForm[K]) => setForm({ ...form, [key]: value });

  return (
    <section className="panel scrape-panel">
      <div className="panel-head">
        <div>
          <h2>Run Scraper</h2>
          <p>Launch legal public-page scraping from the dashboard.</p>
        </div>
        <span className={`pill ${statusClass(scrapeState?.status || "idle")}`}>{scrapeState?.status || "idle"}</span>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Scope</span>
          <select value={form.mode} onChange={(event) => set("mode", event.target.value as ScrapeForm["mode"])}>
            <option value="site">One site</option>
            <option value="all">All sites</option>
          </select>
        </label>

        <label className="field">
          <span>Site</span>
          <select
            value={form.mode === "all" ? "__all" : form.site}
            disabled={form.mode === "all"}
            onChange={(event) => set("site", event.target.value)}
          >
            {form.mode === "all" && (
              <option value="__all">
                All supported sites ({sites.length})
              </option>
            )}
            {sites.map((site) => (
              <option key={site.siteId} value={site.siteId}>
                {site.siteName}
              </option>
            ))}
          </select>
        </label>

        <label className="field wide">
          <span>Role / keywords</span>
          <input value={form.title} onChange={(event) => set("title", event.target.value)} />
        </label>

        <label className="field">
          <span>Location</span>
          <input value={form.location} onChange={(event) => set("location", event.target.value)} />
        </label>

        <label className="field">
          <span>Days</span>
          <input min="0" type="number" value={form.days} onChange={(event) => set("days", event.target.value)} />
        </label>

        <label className="field">
          <span>Max Pages</span>
          <input placeholder="Unlimited" type="number" value={form.maxPages} onChange={(event) => set("maxPages", event.target.value)} />
        </label>

        <label className="field">
          <span>Max Jobs</span>
          <input placeholder="Unlimited" type="number" value={form.maxJobs} onChange={(event) => set("maxJobs", event.target.value)} />
        </label>

        <label className="field wide">
          <span>Resume path</span>
          <input placeholder="C:\\Users\\...\\resume.pdf" value={form.resume} onChange={(event) => set("resume", event.target.value)} />
        </label>

        <label className="field upload-field">
          <span>Upload resume</span>
          <input
            accept=".pdf,.txt,.md,.json,application/pdf,text/plain,application/json"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadResume(file);
              event.currentTarget.value = "";
            }}
          />
        </label>

        <label className="field">
          <span>AI Provider</span>
          <input value="Ollama local" readOnly />
        </label>

        <label className="field">
          <span>Max Expanded</span>
          <input type="number" value={form.maxExpandedTitles} onChange={(event) => set("maxExpandedTitles", event.target.value)} />
        </label>

        <label className="field">
          <span>Min Relevance</span>
          <input type="number" value={form.minRelevanceScore} onChange={(event) => set("minRelevanceScore", event.target.value)} />
        </label>
      </div>

      <div className="toggle-row">
        <label className="toggle">
          <input type="checkbox" checked={form.headless} onChange={(event) => set("headless", event.target.checked)} />
          <span>Headless browser</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={form.strictKeyword} onChange={(event) => set("strictKeyword", event.target.checked)} />
          <span>Strict keyword filter</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={form.strictTitle} onChange={(event) => set("strictTitle", event.target.checked)} />
          <span>Strict title filter</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={form.validateUrls} onChange={(event) => set("validateUrls", event.target.checked)} />
          <span>Validate URLs</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={form.aiExpand} onChange={(event) => set("aiExpand", event.target.checked)} />
          <span>AI expanded titles</span>
        </label>
      </div>

      <div className="button-row">
        <button className="button primary" type="button" disabled={running} onClick={onStart}>
          {running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
          Start scrape
        </button>
        <button className="button secondary" type="button" disabled={!running} onClick={onStop}>
          <CircleStop size={16} />
          Stop
        </button>
      </div>

      <div className="log-box" aria-label="Scrape logs">
        {(scrapeState?.logs || []).slice(-120).map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        ))}
      </div>
    </section>
  );
}

function RunToolbar({
  runs,
  selectedRunId,
  onSelect,
  onRefresh,
  onDeleteRunJobs
}: {
  runs: RunFile[];
  selectedRunId: string;
  onSelect: (runId: string) => void;
  onRefresh: () => void;
  onDeleteRunJobs: () => void;
}) {
  return (
    <section className="toolbar panel">
      <label className="field run-select">
        <span>Run</span>
        <select value={selectedRunId} onChange={(event) => onSelect(event.target.value)}>
          {runs.map((run) => (
            <option key={run.runId} value={run.runId}>
              {formatDate(run.createdAt)} - {run.jobCount} jobs - {run.siteCount} sites
            </option>
          ))}
        </select>
      </label>
      <button className="button secondary" type="button" onClick={onRefresh}>
        <RefreshCw size={16} />
        Refresh
      </button>
      {selectedRunId && (
        <>
          <a className="button primary" href={downloadUrl(selectedRunId, "excel")}>
            <FileSpreadsheet size={16} />
            Excel
          </a>
          <a className="button secondary" href={downloadUrl(selectedRunId, "jobs")}>
            <FileJson size={16} />
            Jobs JSON
          </a>
          <a className="button secondary" href={downloadUrl(selectedRunId, "status")}>
            <Download size={16} />
            Status JSON
          </a>
          <button className="button danger" type="button" onClick={onDeleteRunJobs}>
            <Trash2 size={16} />
            Delete run jobs
          </button>
        </>
      )}
    </section>
  );
}

function AnalyticsPanels({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return null;
  return (
    <section className="analytics-grid">
      <article className="panel">
        <div className="panel-head">
          <h2>Score Distribution</h2>
          <BarChart3 size={18} />
        </div>
        <Bars rows={analytics.scoreBuckets} />
      </article>
      <article className="panel">
        <div className="panel-head">
          <h2>Sources</h2>
          <Activity size={18} />
        </div>
        <Bars rows={analytics.sourceCounts} />
      </article>
      <article className="panel">
        <div className="panel-head">
          <h2>Locations</h2>
          <SlidersHorizontal size={18} />
        </div>
        <Bars rows={analytics.locationCounts} />
      </article>
      <article className="panel">
        <div className="panel-head">
          <h2>Skills</h2>
          <CheckCircle2 size={18} />
        </div>
        <Bars rows={analytics.skillCounts} />
      </article>
    </section>
  );
}

function StatusPanel({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Site Status</h2>
        <span>{analytics.siteStatus.length} sites</span>
      </div>
      <div className="table-wrap short">
        <table>
          <thead>
            <tr>
              <th>Site</th>
              <th>Status</th>
              <th>Pages</th>
              <th>Cards</th>
              <th>Details</th>
              <th>Saved</th>
              <th>Date Filtered</th>
              <th>Relevance Filtered</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {analytics.siteStatus.map((site) => (
              <tr key={site.siteId}>
                <td>{site.siteName}</td>
                <td>
                  <span className={`pill ${statusClass(site.status)}`}>{site.status}</span>
                </td>
                <td>{site.pagesChecked || 0}</td>
                <td>{site.jobCardsFound || site.found}</td>
                <td>{site.detailPagesOpened || 0}</td>
                <td>{site.jobsSaved || site.scraped}</td>
                <td>{site.jobsFilteredByDate || 0}</td>
                <td>{site.jobsFilteredByRelevance || 0}</td>
                <td>{site.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AIExpansionPanel({ analytics }: { analytics: Analytics | null }) {
  if (!analytics?.aiExpansion?.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>AI Expansion Report</h2>
        <span>{analytics.aiExpansion.length} titles</span>
      </div>
      <div className="table-wrap short">
        <table>
          <thead>
            <tr>
              <th>Original</th>
              <th>Expanded Title</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Provider</th>
            </tr>
          </thead>
          <tbody>
            {analytics.aiExpansion.map((item) => (
              <tr key={`${item.title}-${item.priority}`}>
                <td>{item.originalTitle}</td>
                <td>{item.title}</td>
                <td>{item.category}</td>
                <td>{item.priority}</td>
                <td>{item.providerUsed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FiltersPanel({
  filters,
  setFilters,
  sourceSites,
  matchedTitles,
  onExport,
  selectedCount,
  visibleCount,
  onDeleteSelected,
  onDeleteVisible
}: {
  filters: Filters;
  setFilters: (filters: Filters) => void;
  sourceSites: string[];
  matchedTitles: string[];
  onExport: () => void;
  selectedCount: number;
  visibleCount: number;
  onDeleteSelected: () => void;
  onDeleteVisible: () => void;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters({ ...filters, [key]: value });
  return (
    <section className="filters panel">
      <label className="field search-field">
        <span>Search</span>
        <div className="input-icon">
          <Search size={16} />
          <input
            value={filters.query}
            onChange={(event) => set("query", event.target.value)}
            placeholder="Title, company, location, recruiter, skill"
            type="search"
          />
        </div>
      </label>
      <label className="field">
        <span>Site</span>
        <select value={filters.site} onChange={(event) => set("site", event.target.value)}>
          <option value="">All</option>
          {sourceSites.map((site) => (
            <option key={site} value={site}>
              {site}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Tracking</span>
        <select value={filters.status} onChange={(event) => set("status", event.target.value)}>
          <option value="">All</option>
          <option value="Pending">Pending</option>
          <option value="Done">Done</option>
          <option value="Rejected">Rejected</option>
          <option value="Saved">Saved</option>
          <option value="Applied">Applied</option>
        </select>
      </label>
      <label className="field">
        <span>Matched Title</span>
        <select value={filters.matchedTitle} onChange={(event) => set("matchedTitle", event.target.value)}>
          <option value="">All</option>
          {matchedTitles.map((title) => (
            <option key={title} value={title}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <label className="field compact">
        <span>Location</span>
        <input value={filters.location} onChange={(event) => set("location", event.target.value)} />
      </label>
      <label className="field compact">
        <span>From</span>
        <input type="date" value={filters.fromDate} onChange={(event) => set("fromDate", event.target.value)} />
      </label>
      <label className="field compact">
        <span>To</span>
        <input type="date" value={filters.toDate} onChange={(event) => set("toDate", event.target.value)} />
      </label>
      <label className="field compact">
        <span>Min Relevance</span>
        <input value={filters.minScore} onChange={(event) => set("minScore", event.target.value)} type="number" min="0" max="100" />
      </label>
      <label className="field compact">
        <span>Min Resume</span>
        <input value={filters.minResumeScore} onChange={(event) => set("minResumeScore", event.target.value)} type="number" min="0" max="100" />
      </label>
      <label className="field">
        <span>Sort</span>
        <select value={filters.sortBy} onChange={(event) => set("sortBy", event.target.value as Filters["sortBy"])}>
          <option value="relevance">Relevance</option>
          <option value="resume">Resume match</option>
          <option value="postedDate">Posted date</option>
          <option value="website">Website</option>
        </select>
      </label>
      <label className="toggle filter-toggle">
        <input checked={filters.missingRecruiter} onChange={(event) => set("missingRecruiter", event.target.checked)} type="checkbox" />
        <span>Missing recruiter</span>
      </label>
      <label className="toggle filter-toggle">
        <input checked={filters.missingSalary} onChange={(event) => set("missingSalary", event.target.checked)} type="checkbox" />
        <span>Missing salary</span>
      </label>
      <label className="toggle filter-toggle">
        <input checked={filters.duplicateRemoved} onChange={(event) => set("duplicateRemoved", event.target.checked)} type="checkbox" />
        <span>Duplicate removed</span>
      </label>
      <button className="button secondary" type="button" onClick={onExport}>
        <Download size={16} />
        CSV
      </button>
      <button className="button danger" type="button" disabled={selectedCount === 0} onClick={onDeleteSelected}>
        <Trash2 size={16} />
        Delete selected ({selectedCount})
      </button>
      <button className="button danger" type="button" disabled={visibleCount === 0} onClick={onDeleteVisible}>
        <Trash2 size={16} />
        Delete visible ({visibleCount})
      </button>
    </section>
  );
}

function JobsTable({
  jobs,
  statuses,
  selected,
  allVisibleSelected,
  partiallySelected,
  onToggleSelected,
  onToggleVisible,
  onSetStatus,
  onOpen,
  onDelete
}: {
  jobs: JobRecord[];
  statuses: Record<string, string>;
  selected: Record<string, boolean>;
  allVisibleSelected: boolean;
  partiallySelected: boolean;
  onToggleSelected: (job: JobRecord) => void;
  onToggleVisible: () => void;
  onSetStatus: (job: JobRecord, status: string) => void;
  onOpen: (job: JobRecord) => void;
  onDelete: (job: JobRecord) => void;
}) {
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  return (
    <section className="panel jobs-panel">
      <div className="panel-head">
        <h2>Jobs</h2>
        <span>{jobs.length} visible</span>
      </div>
      <div className="table-wrap jobs-wrap">
        <table className="jobs-table">
          <thead>
            <tr>
              <th className="select-cell">
                <input
                  ref={selectAllRef}
                  aria-label="Select all visible jobs"
                  checked={allVisibleSelected}
                  onChange={onToggleVisible}
                  type="checkbox"
                />
              </th>
              <th>Score</th>
              <th>Resume</th>
              <th>Posted</th>
              <th>Job</th>
              <th>Matched Title</th>
              <th>Site</th>
              <th>Location</th>
              <th>Recruiter</th>
              <th>Email</th>
              <th>Code</th>
              <th>Track</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const key = jobKey(job);
              const email = isMissing(job.recruiterEmail) ? job.recruiterEmailPattern || "Not publicly available" : job.recruiterEmail;
              const status = applicationStatusOf(job, statuses);
              return (
                <tr key={key}>
                  <td className="select-cell">
                    <input
                      aria-label={`Select ${job.jobTitle || "job"}`}
                      checked={Boolean(selected[key])}
                      onChange={() => onToggleSelected(job)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <span className={`pill ${scoreOf(job) >= 80 ? "good" : scoreOf(job) >= 60 ? "warn" : ""}`}>
                      {scoreOf(job) || "-"}
                    </span>
                  </td>
                  <td>{job.resumeMatchScore || "-"}</td>
                  <td>{job.postedDate}</td>
                  <td>
                    <button className="link-button" type="button" onClick={() => onOpen(job)}>
                      <span className="job-title">{job.jobTitle || "Untitled"}</span>
                      <span className="subtext">{job.company || job.agency}</span>
                    </button>
                  </td>
                  <td>{job.matchedSearchTitle || job.originalSearchTitle}</td>
                  <td>{job.sourceSite}</td>
                  <td>{job.location}</td>
                  <td>{job.recruiterName || "Not publicly available"}</td>
                  <td>{email}</td>
                  <td>{job.sourceJobId}</td>
                  <td>
                    <select className="status-select" value={status} onChange={(event) => onSetStatus(job, event.target.value)}>
                      {["Pending", "Done", "Rejected", "Saved", "Applied"].map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="icon-button danger" type="button" onClick={() => onDelete(job)} aria-label={`Delete ${job.jobTitle || "job"}`}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LogsPanel({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return null;
  return (
    <section className="logs-grid">
      <article className="panel">
        <div className="panel-head">
          <h2>Warnings</h2>
          <span>{analytics.warnings.length}</span>
        </div>
        <div className="log-list">
          {analytics.warnings.length ? (
            analytics.warnings.slice(0, 80).map((item, index) => (
              <div className="log-item" key={`${item.siteId}-${index}`}>
                <strong>{item.siteName}</strong>
                <span>{item.message}</span>
              </div>
            ))
          ) : (
            <div className="empty-inline">No warnings</div>
          )}
        </div>
      </article>
      <article className="panel">
        <div className="panel-head">
          <h2>Errors</h2>
          <span>{analytics.errors.length}</span>
        </div>
        <div className="log-list">
          {analytics.errors.length ? (
            analytics.errors.slice(0, 80).map((item, index) => (
              <div className="log-item" key={`${item.siteId}-${index}`}>
                <strong>{item.siteName}</strong>
                <span>{item.message}</span>
              </div>
            ))
          ) : (
            <div className="empty-inline">No errors</div>
          )}
        </div>
      </article>
    </section>
  );
}

function JobDrawer({
  job,
  status,
  onClose,
  onSetStatus,
  onDelete
}: {
  job: JobRecord | null;
  status: string;
  onClose: () => void;
  onSetStatus: (status: string) => void;
  onDelete: () => void;
}) {
  if (!job) return null;
  const email = isMissing(job.recruiterEmail) ? job.recruiterEmailPattern || job.recruiterEmail : job.recruiterEmail;
  return (
    <aside className="drawer">
      <div className="drawer-head">
        <div>
          <h2>{job.jobTitle || "Job detail"}</h2>
          <p>{[job.company || job.agency, job.location, job.sourceSite].filter(Boolean).join(" | ")}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="drawer-body">
        <div className="detail-grid">
          <Detail label="Score" value={scoreOf(job) || "-"} />
          <Detail label="Score Source" value={job.matchScoreSource || "keyword"} />
          <Detail label="Posted" value={job.postedDate} />
          <Detail label="Job Code" value={job.sourceJobId} />
          <Detail label="Recruiter" value={job.recruiterName} />
          <Detail label="Email" value={email} />
          <Detail label="Phone" value={job.recruiterPhone} />
          <Detail label="Work Type" value={job.contractType || job.jobType || job.workPattern} />
          <Detail label="Salary" value={job.salary} />
          <Detail label="Application" value={status} />
          <Detail label="Matched Title" value={job.matchedSearchTitle || job.originalSearchTitle} />
          <Detail label="AI Expanded" value={job.aiExpandedTitleUsed ? "Yes" : "No"} />
          <Detail label="Semantic Relevance" value={job.semanticRelevanceScore || "-"} />
          <Detail label="Resume Match" value={job.resumeMatchScore || "-"} />
        </div>
        <div className="button-row">
          <a className="button primary" href={job.applyUrl || job.jobUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Apply
          </a>
          <a className="button secondary" href={job.jobUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Job Page
          </a>
          {["Pending", "Done", "Applied"].map((item) => (
            <button className="button secondary" type="button" key={item} onClick={() => onSetStatus(item)}>
              Mark {item}
            </button>
          ))}
          <button className="button secondary" type="button" onClick={() => navigator.clipboard.writeText(job.applyUrl || job.jobUrl)}>
            Copy Apply URL
          </button>
          <button className="button danger" type="button" onClick={onDelete}>
            <Trash2 size={16} />
            Delete
          </button>
        </div>
        <DetailBlock label="Why Strong Fit" value={job.whyStrongFit || "Not scored yet"} />
        <DetailBlock label="Key Skills" value={(job.keySkills || []).join(", ") || "Not publicly available"} />
        <DetailBlock label="Match Gaps" value={(job.matchGaps || []).join(", ") || "None recorded"} />
        <DetailBlock label="Description" value={job.description || ""} pre />
        <DetailBlock label="Site Specific Fields" value={JSON.stringify(job.siteSpecificFields || {}, null, 2)} pre />
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="detail-cell">
      <span>{label}</span>
      <strong>{value || "Not publicly available"}</strong>
    </div>
  );
}

function DetailBlock({ label, value, pre }: { label: string; value: string; pre?: boolean }) {
  return (
    <div className="detail-block">
      <span>{label}</span>
      {pre ? <pre>{value}</pre> : <p>{value}</p>}
    </div>
  );
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function App() {
  const [runs, setRuns] = useState<RunFile[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [payload, setPayload] = useState<RunPayload | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [form, setForm] = useState<ScrapeForm>(defaultForm);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [scrapeState, setScrapeState] = useState<ScrapeState | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>(() => JSON.parse(localStorage.getItem("ukJobDashboardStatuses") || "{}"));
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [waitingForNewRun, setWaitingForNewRun] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const jobs = payload?.jobs || [];
  const analytics = payload?.analytics || null;

  const sourceSites = useMemo(
    () => [...new Set(jobs.map((job) => job.sourceSite).filter((site): site is string => Boolean(site)))].sort(),
    [jobs]
  );
  const matchedTitles = useMemo(
    () => [...new Set(jobs.map((job) => job.matchedSearchTitle).filter((title): title is string => Boolean(title)))].sort(),
    [jobs]
  );
  const filteredJobs = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const minScore = Number(filters.minScore || 0);
    const minResumeScore = Number(filters.minResumeScore || 0);
    return jobs
      .filter((job) => {
        if (filters.site && job.sourceSite !== filters.site) return false;
        if (filters.status && applicationStatusOf(job, statuses) !== filters.status) return false;
        if (filters.matchedTitle && job.matchedSearchTitle !== filters.matchedTitle) return false;
        if (filters.location && !String(job.location || "").toLowerCase().includes(filters.location.toLowerCase())) return false;
        if (filters.fromDate && String(job.postedDate || "") < filters.fromDate) return false;
        if (filters.toDate && String(job.postedDate || "") > filters.toDate) return false;
        if (filters.missingRecruiter && !isMissing(job.recruiterName) && !isMissing(job.recruiterEmail)) return false;
        if (filters.missingSalary && !isMissing(job.salary)) return false;
        if (filters.duplicateRemoved) return false;
        if (minScore && scoreOf(job) < minScore) return false;
        if (minResumeScore && Number(job.resumeMatchScore || 0) < minResumeScore) return false;
        if (!query) return true;
        return [
          job.jobTitle,
          job.company,
          job.agency,
          job.sourceSite,
          job.location,
          job.recruiterName,
          job.recruiterEmail,
          job.sourceJobId,
          job.description,
          job.matchedSearchTitle,
          ...(job.keySkills || [])
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        if (filters.sortBy === "postedDate") return String(b.postedDate).localeCompare(String(a.postedDate));
        if (filters.sortBy === "resume") return Number(b.resumeMatchScore || 0) - Number(a.resumeMatchScore || 0);
        if (filters.sortBy === "website") return String(a.sourceSite).localeCompare(String(b.sourceSite));
        return scoreOf(b) - scoreOf(a) || String(b.postedDate).localeCompare(String(a.postedDate));
      });
  }, [filters, jobs, statuses]);
  const visibleKeys = useMemo(() => filteredJobs.map(jobKey), [filteredJobs]);
  const selectedKeys = useMemo(() => Object.keys(selected).filter((key) => selected[key]), [selected]);
  const selectedVisibleCount = visibleKeys.filter((key) => selected[key]).length;
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
  const partiallySelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleKeys.length;

  async function loadRuns(keepRunId = selectedRunId) {
    const nextRuns = await getRuns();
    setRuns(nextRuns);
    if (!nextRuns.length) {
      setPayload(null);
      setSelectedRunId("");
      return;
    }
    const runId = keepRunId && nextRuns.some((run) => run.runId === keepRunId) ? keepRunId : nextRuns[0].runId;
    await loadRun(runId);
  }

  async function loadRun(runId: string) {
    const nextPayload = await getRun(runId);
    setPayload(nextPayload);
    setSelectedRunId(runId);
    setSelected({});
  }

  async function refreshScrapeState() {
    const nextState = await getScrapeState();
    setScrapeState(nextState);
    if ((nextState.status === "completed" || nextState.status === "failed" || nextState.status === "stopped") && nextState.latestRunId) {
      await loadRuns(nextState.latestRunId);
      setWaitingForNewRun(false);
    } else if (nextState.status === "failed" || nextState.status === "stopped") {
      setWaitingForNewRun(false);
    }
  }

  async function start() {
    setError("");
    try {
      const nextState = await startScrape(form);
      setScrapeState(nextState);
      setWaitingForNewRun(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stop() {
    setScrapeState(await stopScrape());
  }

  async function handleResumeUpload(file: File) {
    setError("");
    try {
      const uploaded = await uploadResume(file);
      setForm((current) => ({ ...current, resume: uploaded.path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function setApplicationStatus(job: JobRecord, status: string) {
    const key = jobKey(job);
    const next = { ...statuses, [key]: status };
    setStatuses(next);
    localStorage.setItem("ukJobDashboardStatuses", JSON.stringify(next));
  }

  function toggleSelected(job: JobRecord) {
    const key = jobKey(job);
    setSelected((current) => ({ ...current, [key]: !current[key] }));
  }

  function toggleVisibleSelection() {
    setSelected((current) => {
      const next = { ...current };
      if (allVisibleSelected) {
        for (const key of visibleKeys) delete next[key];
      } else {
        for (const key of visibleKeys) next[key] = true;
      }
      return next;
    });
  }

  function removeDeletedLocalState(keys: string[]) {
    setSelected((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setStatuses((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of keys) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
      }
      if (changed) localStorage.setItem("ukJobDashboardStatuses", JSON.stringify(next));
      return next;
    });
    if (selectedJob && keys.includes(jobKey(selectedJob))) {
      setSelectedJob(null);
    }
  }

  async function deleteJobs(keys: string[], label: string) {
    if (!selectedRunId || keys.length === 0) return;
    if (!window.confirm(`Delete ${keys.length} ${label}? This updates the saved JSON and Excel files for this run.`)) return;

    setError("");
    try {
      const result = await deleteRunJobs(selectedRunId, keys);
      setPayload(result.payload || null);
      removeDeletedLocalState(keys);
      await loadRuns(selectedRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteAllVisibleJobs() {
    await deleteJobs(visibleKeys, "visible job records");
  }

  async function deleteSelectedJobs() {
    await deleteJobs(selectedKeys, "selected job records");
  }

  async function deleteOneJob(job: JobRecord) {
    await deleteJobs([jobKey(job)], "job record");
  }

  async function deleteEntireRunJobs() {
    if (!selectedRunId || jobs.length === 0) return;
    if (!window.confirm(`Delete all ${jobs.length} job records from this run? This keeps the run status file but clears saved jobs and Excel rows.`)) return;

    setError("");
    try {
      const result = await deleteAllRunJobs(selectedRunId);
      setPayload(result.payload || null);
      removeDeletedLocalState(jobs.map(jobKey));
      await loadRuns(selectedRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function exportFilteredCsv() {
    const headers = ["Job Title", "Matched Title", "Company", "Location", "Posted Date", "Relevance", "Resume", "Recruiter", "Email", "Phone", "Job Code", "Status", "Apply URL"];
    const lines = [
      headers.join(","),
      ...filteredJobs.map((job) =>
        [
          job.jobTitle,
          job.matchedSearchTitle,
          job.company || job.agency,
          job.location,
          job.postedDate,
          scoreOf(job),
          job.resumeMatchScore,
          job.recruiterName,
          job.recruiterEmail,
          job.recruiterPhone,
          job.sourceJobId,
          applicationStatusOf(job, statuses),
          job.applyUrl
        ]
          .map(csvEscape)
          .join(",")
      )
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `filtered-jobs-${selectedRunId || "run"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    Promise.all([getSites(), loadRuns(), refreshScrapeState()])
      .then(([siteOptions]) => setSites(siteOptions))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      refreshScrapeState().catch(() => undefined);
    }, scrapeState?.status === "running" ? 1500 : 6000);
    return () => window.clearInterval(interval);
  }, [scrapeState?.status, selectedRunId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [scrapeState?.logs]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="identity">
          <div className="mark">UK</div>
          <div>
            <h1>Recruitment Scraper Control Center</h1>
            <p>{selectedRunId ? `${formatDate(payload?.run?.createdAt)} | ${jobs.length} jobs loaded` : "No run selected"}</p>
          </div>
        </div>
      </header>

      <main className="layout">
        {error && <div className="alert bad">{error}</div>}

        <ScrapePanel
          form={form}
          setForm={setForm}
          sites={sites}
          scrapeState={scrapeState}
          onStart={start}
          onStop={stop}
          onUploadResume={handleResumeUpload}
        />

        <RunToolbar
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={loadRun}
          onRefresh={() => loadRuns()}
          onDeleteRunJobs={deleteEntireRunJobs}
        />

        {waitingForNewRun && (
          <section className="pending-results panel">
            <h2>Scrape Running</h2>
            <p>New results will load in this table automatically when the scrape finishes.</p>
          </section>
        )}

        {!payload?.run ? (
          <section className="empty-state panel">
            <h2>No scrape runs found</h2>
            <p>Start a scrape above. Results will appear here when the run completes.</p>
          </section>
        ) : (
          <>
            <section className="metrics-grid">
              <MetricCard label="Jobs" value={analytics?.summary.totalJobs || 0} note={`${filteredJobs.length} visible`} />
              <MetricCard label="After Date Filter" value={analytics?.summary.jobsAfterDateFilter || 0} />
              <MetricCard label="After AI Filter" value={analytics?.summary.jobsAfterRelevanceFilter || 0} />
              <MetricCard label="Duplicates Removed" value={analytics?.summary.duplicatesRemoved || 0} />
              <MetricCard label="Missing Recruiter" value={analytics?.summary.missingRecruiter || 0} />
              <MetricCard label="Missing Salary" value={analytics?.summary.missingSalary || 0} />
              <MetricCard label="Sites Successful" value={analytics?.summary.sitesSuccessful || 0} />
              <MetricCard label="Sites Warnings" value={analytics?.summary.sitesWithWarnings || 0} note={`${analytics?.summary.sitesWithNoMatchingJobs || 0} no matches`} />
            </section>

            <FiltersPanel
              filters={filters}
              setFilters={setFilters}
              sourceSites={sourceSites}
              matchedTitles={matchedTitles}
              onExport={exportFilteredCsv}
              selectedCount={selectedKeys.length}
              visibleCount={filteredJobs.length}
              onDeleteSelected={deleteSelectedJobs}
              onDeleteVisible={deleteAllVisibleJobs}
            />
            <AnalyticsPanels analytics={analytics} />
            <AIExpansionPanel analytics={analytics} />
            <StatusPanel analytics={analytics} />
            <JobsTable
              jobs={filteredJobs}
              statuses={statuses}
              selected={selected}
              allVisibleSelected={allVisibleSelected}
              partiallySelected={partiallySelected}
              onToggleSelected={toggleSelected}
              onToggleVisible={toggleVisibleSelection}
              onSetStatus={setApplicationStatus}
              onOpen={setSelectedJob}
              onDelete={deleteOneJob}
            />
            <LogsPanel analytics={analytics} />
          </>
        )}
      </main>

      <JobDrawer
        job={selectedJob}
        status={selectedJob ? applicationStatusOf(selectedJob, statuses) : "Pending"}
        onClose={() => setSelectedJob(null)}
        onSetStatus={(status) => selectedJob && setApplicationStatus(selectedJob, status)}
        onDelete={() => selectedJob && deleteOneJob(selectedJob)}
      />
    </div>
  );
}
