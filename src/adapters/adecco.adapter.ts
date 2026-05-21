import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const adeccoAdapter = createGenericAdapter({
  siteId: "adecco",
  siteName: "Adecco UK",
  baseUrl: "https://www.adecco.com",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.adecco.com/en-gb/job-search", {
      keyword: input.title,
      location: input.location
    });
  }
});
