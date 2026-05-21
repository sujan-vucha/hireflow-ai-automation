import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const tigerAdapter = createGenericAdapter({
  siteId: "tiger",
  siteName: "Tiger Recruitment",
  baseUrl: "https://tiger-recruitment.com",
  crawlMode: "cheerio",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://tiger-recruitment.com/jobs/", {
      keyword: input.title,
      location: input.location
    });
  }
});

