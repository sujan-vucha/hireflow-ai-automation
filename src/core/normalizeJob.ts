import { normalizeText, extractEmail, extractPhone, extractRecruiterName } from "../utils.js";

export function parseJsonLdJobs(rawScripts: string[]): any[] {
  const jobs: any[] = [];

  for (const raw of rawScripts) {
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of arr) {
        if (item?.["@type"] === "JobPosting") jobs.push(item);
        if (Array.isArray(item?.["@graph"])) {
          for (const graphItem of item["@graph"]) {
            if (graphItem?.["@type"] === "JobPosting") jobs.push(graphItem);
          }
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  return jobs;
}

export function mapJsonLdJob(job: any, url: string, fallbackTitle: string, fallbackText: string) {
  const locationAddress = Array.isArray(job.jobLocation)
    ? job.jobLocation?.[0]?.address
    : job.jobLocation?.address;

  return {
    jobUrl: url,
    title: normalizeText(job.title || fallbackTitle),
    company: normalizeText(job.hiringOrganization?.name || ""),
    location: normalizeText(
      locationAddress?.addressLocality ||
      locationAddress?.addressRegion ||
      locationAddress?.addressCountry ||
      ""
    ),
    postedDate: job.datePosted || "",
    validThrough: job.validThrough || "",
    employmentType: Array.isArray(job.employmentType)
      ? job.employmentType.join(", ")
      : job.employmentType || "",
    salary: job.baseSalary?.value?.value || job.baseSalary?.value?.minValue || "",
    currency: job.baseSalary?.currency || "",
    description: normalizeText(job.description || fallbackText).slice(0, 12000),
    recruiterName: extractRecruiterName(fallbackText),
    recruiterEmail: extractEmail(fallbackText),
    recruiterPhone: extractPhone(fallbackText),
    extractionMethod: "json-ld"
  };
}

export function mapFallbackJob(url: string, title: string, pageText: string) {
  return {
    jobUrl: url,
    title: normalizeText(title),
    company: "",
    location: "",
    postedDate: "",
    validThrough: "",
    employmentType: "",
    salary: "",
    currency: "",
    description: normalizeText(pageText).slice(0, 12000),
    recruiterName: extractRecruiterName(pageText),
    recruiterEmail: extractEmail(pageText),
    recruiterPhone: extractPhone(pageText),
    extractionMethod: "fallback-page-text"
  };
}
