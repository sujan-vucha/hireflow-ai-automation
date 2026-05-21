const state = {
  runs: [],
  payload: null,
  jobs: [],
  analytics: null,
  selectedRunId: "",
  done: JSON.parse(localStorage.getItem("ukJobDashboardDone") || "{}")
};

const els = {
  runMeta: document.getElementById("runMeta"),
  runSelect: document.getElementById("runSelect"),
  refreshButton: document.getElementById("refreshButton"),
  excelLink: document.getElementById("excelLink"),
  jobsJsonLink: document.getElementById("jobsJsonLink"),
  emptyState: document.getElementById("emptyState"),
  dashboardContent: document.getElementById("dashboardContent"),
  metrics: document.getElementById("metrics"),
  searchInput: document.getElementById("searchInput"),
  siteFilter: document.getElementById("siteFilter"),
  statusFilter: document.getElementById("statusFilter"),
  scoreFilter: document.getElementById("scoreFilter"),
  missingEmailFilter: document.getElementById("missingEmailFilter"),
  csvButton: document.getElementById("csvButton"),
  siteStatusCount: document.getElementById("siteStatusCount"),
  siteStatusBody: document.getElementById("siteStatusBody"),
  scoreBars: document.getElementById("scoreBars"),
  locationBars: document.getElementById("locationBars"),
  sourceBars: document.getElementById("sourceBars"),
  skillBars: document.getElementById("skillBars"),
  jobCount: document.getElementById("jobCount"),
  jobsBody: document.getElementById("jobsBody"),
  warningsList: document.getElementById("warningsList"),
  warningCount: document.getElementById("warningCount"),
  errorsList: document.getElementById("errorsList"),
  errorCount: document.getElementById("errorCount"),
  detailDrawer: document.getElementById("detailDrawer"),
  detailTitle: document.getElementById("detailTitle"),
  detailSubTitle: document.getElementById("detailSubTitle"),
  detailContent: document.getElementById("detailContent"),
  closeDrawer: document.getElementById("closeDrawer")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jobKey(job) {
  return job.jobUrl || `${job.sourceSite}:${job.sourceJobId}:${job.jobTitle}`;
}

function isMissing(value) {
  return !value || String(value).trim() === "" || String(value).trim() === "Not publicly available";
}

function scoreOf(job) {
  return Number(job.resumeMatchScore || job.roleMatchScore || 0);
}

function formatDate(value) {
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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function setDone(job, done) {
  state.done[jobKey(job)] = done;
  localStorage.setItem("ukJobDashboardDone", JSON.stringify(state.done));
  renderAll();
}

function doneCount() {
  return state.jobs.filter((job) => state.done[jobKey(job)]).length;
}

function configureDownloads(runId) {
  if (!runId) {
    for (const link of [els.excelLink, els.jobsJsonLink]) {
      link.href = "#";
      link.setAttribute("aria-disabled", "true");
    }
    return;
  }

  els.excelLink.href = `/api/download/${encodeURIComponent(runId)}/excel`;
  els.jobsJsonLink.href = `/api/download/${encodeURIComponent(runId)}/jobs`;
  els.excelLink.setAttribute("aria-disabled", "false");
  els.jobsJsonLink.setAttribute("aria-disabled", "false");
}

async function loadRuns(selectRunId) {
  state.runs = await fetchJson("/api/runs");
  els.runSelect.innerHTML = state.runs
    .map(
      (run) =>
        `<option value="${escapeHtml(run.runId)}">${escapeHtml(formatDate(run.createdAt))} - ${run.jobCount} jobs</option>`
    )
    .join("");

  if (state.runs.length === 0) {
    state.payload = null;
    state.jobs = [];
    state.analytics = null;
    renderAll();
    return;
  }

  const runId = selectRunId || state.selectedRunId || state.runs[0].runId;
  await loadRun(runId);
}

async function loadRun(runId) {
  state.selectedRunId = runId;
  state.payload = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
  state.jobs = state.payload.jobs || [];
  state.analytics = state.payload.analytics;
  els.runSelect.value = runId;
  configureDownloads(runId);
  updateFilterOptions();
  renderAll();
}

function updateFilterOptions() {
  const sites = [...new Set(state.jobs.map((job) => job.sourceSite).filter(Boolean))].sort();
  const current = els.siteFilter.value;
  els.siteFilter.innerHTML = `<option value="">All</option>${sites
    .map((site) => `<option value="${escapeHtml(site)}">${escapeHtml(site)}</option>`)
    .join("")}`;
  if (sites.includes(current)) els.siteFilter.value = current;
}

function filteredJobs() {
  const query = els.searchInput.value.trim().toLowerCase();
  const site = els.siteFilter.value;
  const minScore = Number(els.scoreFilter.value || 0);
  const status = els.statusFilter.value;
  const missingEmail = els.missingEmailFilter.checked;

  return state.jobs
    .filter((job) => {
      if (site && job.sourceSite !== site) return false;
      if (minScore && scoreOf(job) < minScore) return false;
      if (missingEmail && !isMissing(job.recruiterEmail)) return false;
      if (status === "done" && !state.done[jobKey(job)]) return false;
      if (status === "pending" && state.done[jobKey(job)]) return false;
      if (!query) return true;

      const haystack = [
        job.jobTitle,
        job.company,
        job.agency,
        job.sourceSite,
        job.location,
        job.recruiterName,
        job.recruiterEmail,
        job.sourceJobId,
        job.description,
        ...(job.keySkills || [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => scoreOf(b) - scoreOf(a) || String(b.postedDate).localeCompare(String(a.postedDate)));
}

function metric(label, value, note) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(
    note || ""
  )}</span></div>`;
}

function renderMetrics() {
  const summary = state.analytics?.summary || {};
  els.metrics.innerHTML = [
    metric("Jobs", summary.totalJobs || 0, `${filteredJobs().length} visible`),
    metric("Sites", summary.totalSites || 0, "scraped"),
    metric("Avg Match", `${summary.averageMatchScore || 0}%`, "resume or keyword"),
    metric("Avg Confidence", `${summary.averageExtractionConfidence || 0}%`, "extraction"),
    metric("Public Emails", summary.publicEmails || 0, "verified"),
    metric("Missing Emails", summary.missingEmail || 0, "not public"),
    metric("Done", doneCount(), "local tracking"),
    metric("Warnings", summary.warningCount || 0, `${summary.errorCount || 0} errors`)
  ].join("");
}

function pillClass(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("success") || value.includes("scraped")) return "good";
  if (value.includes("warning") || value.includes("partial") || value.includes("low")) return "warn";
  if (value.includes("error") || value.includes("blocked") || value.includes("captcha") || value.includes("missing")) return "bad";
  return "";
}

function renderSiteStatus() {
  const rows = state.analytics?.siteStatus || [];
  els.siteStatusCount.textContent = `${rows.length} sites`;
  els.siteStatusBody.innerHTML = rows
    .map(
      (site) => `<tr>
        <td>${escapeHtml(site.siteName || site.siteId)}</td>
        <td><span class="pill ${pillClass(site.status)}">${escapeHtml(site.status)}</span></td>
        <td>${escapeHtml(site.found)}</td>
        <td>${escapeHtml(site.afterDateFilter)}</td>
        <td>${escapeHtml(site.scraped)}</td>
        <td>${escapeHtml(site.reason)}</td>
      </tr>`
    )
    .join("");
}

function renderBars(element, rows) {
  const max = Math.max(1, ...rows.map((row) => row.count || 0));
  element.innerHTML = rows.length
    ? rows
        .map(
          (row) => `<div class="bar-row" title="${escapeHtml(row.label)}">
            <div class="bar-label">${escapeHtml(row.label)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, (row.count / max) * 100)}%"></div></div>
            <div class="bar-count">${escapeHtml(row.count)}</div>
          </div>`
        )
        .join("")
    : `<div class="subtext">No data</div>`;
}

function renderAnalytics() {
  renderBars(els.scoreBars, state.analytics?.scoreBuckets || []);
  renderBars(els.locationBars, state.analytics?.locationCounts || []);
  renderBars(els.sourceBars, state.analytics?.sourceCounts || []);
  renderBars(els.skillBars, state.analytics?.skillCounts || []);
}

function renderJobs() {
  const jobs = filteredJobs();
  els.jobCount.textContent = `${jobs.length} visible`;
  els.jobsBody.innerHTML = jobs
    .map((job, index) => {
      const done = Boolean(state.done[jobKey(job)]);
      const email = isMissing(job.recruiterEmail) ? job.recruiterEmailPattern || "Not publicly available" : job.recruiterEmail;
      return `<tr data-job-index="${index}">
        <td><span class="pill ${scoreOf(job) >= 80 ? "good" : scoreOf(job) >= 60 ? "warn" : ""}">${scoreOf(job) || "-"}</span></td>
        <td>${escapeHtml(job.postedDate || "")}</td>
        <td>
          <button class="link-button job-open" data-key="${escapeHtml(jobKey(job))}" type="button">
            <span class="job-title">${escapeHtml(job.jobTitle || "Untitled")}</span>
          </button>
          <span class="subtext">${escapeHtml(job.company || job.agency || "")}</span>
        </td>
        <td>${escapeHtml(job.sourceSite || "")}</td>
        <td>${escapeHtml(job.location || "")}</td>
        <td>${escapeHtml(job.recruiterName || "Not publicly available")}</td>
        <td>${escapeHtml(email || "Not publicly available")}</td>
        <td>${escapeHtml(job.sourceJobId || "")}</td>
        <td><button class="track-button ${done ? "done" : ""}" data-track="${escapeHtml(jobKey(job))}" type="button">${
          done ? "Done" : "Pending"
        }</button></td>
      </tr>`;
    })
    .join("");

  for (const button of els.jobsBody.querySelectorAll("[data-track]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const job = state.jobs.find((item) => jobKey(item) === button.getAttribute("data-track"));
      if (job) setDone(job, !state.done[jobKey(job)]);
    });
  }

  for (const button of els.jobsBody.querySelectorAll(".job-open")) {
    button.addEventListener("click", () => {
      const job = state.jobs.find((item) => jobKey(item) === button.getAttribute("data-key"));
      if (job) openDrawer(job);
    });
  }
}

function renderLogs() {
  const warnings = state.analytics?.warnings || [];
  const errors = state.analytics?.errors || [];
  els.warningCount.textContent = `${warnings.length}`;
  els.errorCount.textContent = `${errors.length}`;
  els.warningsList.innerHTML = warnings.length
    ? warnings
        .slice(0, 80)
        .map((item) => `<div class="log-item"><strong>${escapeHtml(item.siteName)}</strong>${escapeHtml(item.message)}</div>`)
        .join("")
    : `<div class="subtext">No warnings</div>`;
  els.errorsList.innerHTML = errors.length
    ? errors
        .slice(0, 80)
        .map((item) => `<div class="log-item"><strong>${escapeHtml(item.siteName)}</strong>${escapeHtml(item.message)}</div>`)
        .join("")
    : `<div class="subtext">No errors</div>`;
}

function detailCell(label, value) {
  return `<div class="detail-cell"><span class="detail-label">${escapeHtml(label)}</span>${escapeHtml(
    value || "Not publicly available"
  )}</div>`;
}

function openDrawer(job) {
  const done = Boolean(state.done[jobKey(job)]);
  els.detailTitle.textContent = job.jobTitle || "Job detail";
  els.detailSubTitle.textContent = [job.company || job.agency, job.location, job.sourceSite].filter(Boolean).join(" | ");
  els.detailContent.innerHTML = `
    <div class="detail-grid">
      ${detailCell("Score", scoreOf(job) || "-")}
      ${detailCell("Score Source", job.matchScoreSource || "keyword")}
      ${detailCell("Posted", job.postedDate)}
      ${detailCell("Job Code", job.sourceJobId)}
      ${detailCell("Recruiter", job.recruiterName)}
      ${detailCell("Email", isMissing(job.recruiterEmail) ? job.recruiterEmailPattern || job.recruiterEmail : job.recruiterEmail)}
      ${detailCell("Phone", job.recruiterPhone)}
      ${detailCell("Work Type", job.contractType || job.jobType || job.workPattern)}
      ${detailCell("Salary", job.salary)}
      ${detailCell("Application", done ? "Done" : "Pending")}
    </div>
    <div class="detail-grid">
      <a class="button primary" href="${escapeHtml(job.applyUrl || job.jobUrl || "#")}" target="_blank" rel="noreferrer">Apply</a>
      <a class="button secondary" href="${escapeHtml(job.jobUrl || "#")}" target="_blank" rel="noreferrer">Job Page</a>
      <button id="detailTrack" class="button secondary" type="button">${done ? "Mark Pending" : "Mark Done"}</button>
    </div>
    <div class="detail-cell">
      <span class="detail-label">Why Strong Fit</span>
      ${escapeHtml(job.whyStrongFit || "Not scored yet")}
    </div>
    <div class="detail-cell">
      <span class="detail-label">Key Skills</span>
      ${escapeHtml((job.keySkills || []).join(", ") || "Not publicly available")}
    </div>
    <div class="detail-cell">
      <span class="detail-label">Match Gaps</span>
      ${escapeHtml((job.matchGaps || []).join(", ") || "None recorded")}
    </div>
    <div class="detail-cell">
      <span class="detail-label">Description</span>
      <div class="description">${escapeHtml(job.description || "")}</div>
    </div>
    <div class="detail-cell">
      <span class="detail-label">Site Specific Fields</span>
      <pre class="description">${escapeHtml(JSON.stringify(job.siteSpecificFields || {}, null, 2))}</pre>
    </div>
  `;
  els.detailDrawer.hidden = false;
  document.getElementById("detailTrack").addEventListener("click", () => {
    setDone(job, !state.done[jobKey(job)]);
    openDrawer(job);
  });
}

function renderAll() {
  const hasRun = Boolean(state.payload?.run);
  els.emptyState.hidden = hasRun;
  els.dashboardContent.hidden = !hasRun;

  if (!hasRun) {
    els.runMeta.textContent = "No output files found";
    configureDownloads("");
    return;
  }

  const run = state.payload.run;
  els.runMeta.textContent = `${formatDate(run.createdAt)} | ${run.jobCount} jobs | ${run.siteCount} sites`;
  renderMetrics();
  renderSiteStatus();
  renderAnalytics();
  renderJobs();
  renderLogs();
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const rows = filteredJobs();
  const headers = [
    "Job Title",
    "Company",
    "Location",
    "Posted Date",
    "Score",
    "Recruiter",
    "Email",
    "Phone",
    "Job Code",
    "Application Status",
    "Apply URL",
    "Job URL"
  ];
  const lines = [
    headers.join(","),
    ...rows.map((job) =>
      [
        job.jobTitle,
        job.company || job.agency,
        job.location,
        job.postedDate,
        scoreOf(job),
        job.recruiterName,
        job.recruiterEmail,
        job.recruiterPhone,
        job.sourceJobId,
        state.done[jobKey(job)] ? "Done" : "Pending",
        job.applyUrl,
        job.jobUrl
      ]
        .map(csvEscape)
        .join(",")
    )
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `filtered-jobs-${state.selectedRunId || "run"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function attachEvents() {
  els.runSelect.addEventListener("change", () => loadRun(els.runSelect.value));
  els.refreshButton.addEventListener("click", () => loadRuns(state.selectedRunId));
  els.searchInput.addEventListener("input", renderAll);
  els.siteFilter.addEventListener("change", renderAll);
  els.statusFilter.addEventListener("change", renderAll);
  els.scoreFilter.addEventListener("input", renderAll);
  els.missingEmailFilter.addEventListener("change", renderAll);
  els.csvButton.addEventListener("click", exportCsv);
  els.closeDrawer.addEventListener("click", () => {
    els.detailDrawer.hidden = true;
  });
}

attachEvents();
loadRuns().catch((error) => {
  els.emptyState.hidden = false;
  els.dashboardContent.hidden = true;
  els.emptyState.innerHTML = `<h2>Dashboard failed to load</h2><p>${escapeHtml(error.message)}</p>`;
});
