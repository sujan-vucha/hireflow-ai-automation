import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const propelAdapter = createGenericAdapter({
  siteId: "propel",
  siteName: "Propel",
  baseUrl: "https://www.propel-together.com",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.propel-together.com/job-search/", {
      keyword: input.title,
      location: input.location
    });
  }
});
