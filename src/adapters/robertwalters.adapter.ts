import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const robertWaltersAdapter = createGenericAdapter({
  siteId: "robertwalters",
  siteName: "Robert Walters UK",
  baseUrl: "https://www.robertwalters.co.uk",
  crawlMode: "cheerio",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.robertwalters.co.uk/jobs.html", {
      keywords: input.title,
      location: input.location
    });
  }
});

