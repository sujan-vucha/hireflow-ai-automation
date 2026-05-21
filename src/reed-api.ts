import "dotenv/config";
import fs from "fs";
import path from "path";
import { createInitialStatus, finalizeStatus, writeStatus } from "./core/status.js";

const apiKey = process.env.REED_API_KEY;

if (!apiKey) {
  throw new Error("Missing REED_API_KEY in .env");
}

const keyword = process.env.REED_KEYWORDS || "Digital Marketing Consultant";
const location = process.env.REED_LOCATION || "United Kingdom";
const limit = Number(process.env.REED_LIMIT || 1000);

const authHeader = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

async function reedSearch(skip: number) {
  const url =
    `https://www.reed.co.uk/api/1.0/search?` +
    new URLSearchParams({
      keywords: keyword,
      locationName: location,
      resultsToTake: "100",
      resultsToSkip: String(skip),
      postedByRecruitmentAgency: "true"
    });

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader
    }
  });

  if (!res.ok) {
    throw new Error(`Reed API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function reedDetails(jobId: number) {
  const url = `https://www.reed.co.uk/api/1.0/jobs/${jobId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader
    }
  });

  if (!res.ok) return null;
  return res.json();
}

const status = createInitialStatus({
  siteId: "reed",
  siteName: "Reed",
  target: limit,
  crawler: "official-api",
  startUrls: ["https://www.reed.co.uk/developers/jobseeker"],
  notes: "Uses Reed official Jobseeker API. No scraping. Requires REED_API_KEY."
});
writeStatus(status);

async function main() {
  const jobs: any[] = [];

  try {
    for (let skip = 0; skip < limit; skip += 100) {
      const data = await reedSearch(skip);
      const results = data.results || [];

      for (const item of results) {
        if (jobs.length >= limit) break;
        const detail = await reedDetails(item.jobId);

        jobs.push({
          sourceSite: "Reed",
          sourceSiteId: "reed",
          legalMode: "official-api",
          jobId: item.jobId,
          title: item.jobTitle,
          company: item.employerName,
          location: item.locationName,
          minimumSalary: item.minimumSalary,
          maximumSalary: item.maximumSalary,
          currency: item.currency,
          contractType: detail?.contractType || item.contractType || "",
          jobType: detail?.jobType || "",
          description: detail?.jobDescription || item.jobDescription || "",
          externalUrl: detail?.externalUrl || "",
          jobUrl: `https://www.reed.co.uk/jobs/${item.jobId}`,
          scrapedAt: new Date().toISOString()
        });
      }

      status.scraped = jobs.length;
      writeStatus(status);

      if (results.length < 100 || jobs.length >= limit) break;
    }

    fs.mkdirSync("output", { recursive: true });
    fs.writeFileSync(path.join("output", "reed-jobs.json"), JSON.stringify(jobs, null, 2));

    finalizeStatus(status, { scraped: jobs.length, blocked: false });
    console.log(`Saved ${jobs.length} Reed jobs to output/reed-jobs.json`);
    console.log("Status saved to output/status/reed.json");
  } catch (error: any) {
    finalizeStatus(status, {
      scraped: jobs.length,
      blocked: false,
      failedReason: error?.message || "Unknown Reed API failure"
    });
    throw error;
  }
}

main();
