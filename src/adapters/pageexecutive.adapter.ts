import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const pageExecutiveAdapter = createGenericAdapter({
  siteId: "pageexecutive",
  siteName: "Page Executive",
  baseUrl: "https://www.pageexecutive.com",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.pageexecutive.com/jobs", {
      search: input.title,
      location: input.location
    });
  }
});
