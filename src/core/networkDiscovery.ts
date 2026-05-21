import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import minimist from "minimist";
import { chromium } from "playwright";
import { getAdapter } from "../config/sites.js";
import { calculateDateRange } from "./dateParser.js";

const interestingPatterns = [
  "job",
  "jobs",
  "search",
  "vacancy",
  "vacancies",
  "position",
  "positions",
  "api",
  "graphql",
  "solr",
  "elastic"
];

export async function discoverPublicNetworkCalls(params: {
  siteId: string;
  url: string;
  headless?: boolean;
  timeoutMs?: number;
}) {
  const browser = await chromium.launch({ headless: params.headless ?? true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });
  const calls = new Map<string, any>();

  page.on("response", async (response) => {
    const url = response.url();
    const lower = url.toLowerCase();
    if (!interestingPatterns.some((pattern) => lower.includes(pattern))) return;
    if (/login|auth|token|account|profile|application/i.test(url)) return;

    calls.set(url, {
      url,
      status: response.status(),
      contentType: response.headers()["content-type"] || ""
    });
  });

  try {
    await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: params.timeoutMs ?? 45000 });
    await page.waitForTimeout(5000);
  } finally {
    await browser.close();
  }

  const discovered = [...calls.values()];
  const outDir = path.join("output", "network-discovery");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${params.siteId}.json`), JSON.stringify(discovered, null, 2));
  return discovered;
}

async function runCli() {
  const args = minimist(process.argv.slice(2));
  const siteId = String(args.site || "custom");
  const range = calculateDateRange(Number(args.days || 7));
  const adapter = args.site ? getAdapter(siteId) : null;
  const url = String(
    args.url ||
      adapter?.buildSearchUrl(
        {
          site: siteId,
          title: String(args.title || "Digital Marketing Consultant"),
          location: String(args.location || "United Kingdom"),
          days: Number(args.days || 7),
          fromDate: range.fromDate,
          toDate: range.toDate,
          headless: args.headless !== "false"
        },
        String(args.title || "Digital Marketing Consultant"),
        1
      ) ||
      ""
  );
  if (!url) {
    throw new Error("Pass --site=hays or --url=https://example.com/jobs for network discovery.");
  }
  const calls = await discoverPublicNetworkCalls({ siteId, url, headless: args.headless !== "false" });
  console.log(`Saved ${calls.length} discovered calls to output/network-discovery/${siteId}.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
