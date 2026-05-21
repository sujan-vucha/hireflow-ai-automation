import { chromium } from "playwright";
import minimist from "minimist";
import { sites } from "./sites/config.js";

const args = minimist(process.argv.slice(2));
const siteId = args.site;
const explicitUrl = args.url;

if (!siteId && !explicitUrl) {
  throw new Error("Pass --site=michaelpage or --url=https://example.com/jobs");
}

const site = siteId ? sites.find((s) => s.id === siteId) : null;
const url = explicitUrl || site?.startUrls?.[0];

if (!url) {
  throw new Error("No URL found for network discovery.");
}

const interesting: string[] = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("request", (request) => {
  const type = request.resourceType();
  const requestUrl = request.url();

  if (["xhr", "fetch"].includes(type)) {
    const lower = requestUrl.toLowerCase();
    if (
      lower.includes("job") ||
      lower.includes("vacancy") ||
      lower.includes("search") ||
      lower.includes("api")
    ) {
      interesting.push(requestUrl);
    }
  }
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.mouse.wheel(0, 3000).catch(() => {});
await page.waitForTimeout(5000);

console.log("Interesting public XHR/fetch URLs detected:");
console.log([...new Set(interesting)].join("\n") || "None detected.");

await browser.close();
