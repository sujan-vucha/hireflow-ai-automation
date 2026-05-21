import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const randstadAdapter = createGenericAdapter({
  siteId: "randstad",
  siteName: "Randstad UK",
  baseUrl: "https://www.randstad.co.uk",
  crawlMode: "cheerio",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.randstad.co.uk/jobs/", {
      keywords: input.title,
      location: input.location
    });
  }
});

