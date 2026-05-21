import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const huntressAdapter = createGenericAdapter({
  siteId: "huntress",
  siteName: "Huntress",
  baseUrl: "https://www.huntress.co.uk",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://www.huntress.co.uk/jobs", {});
  }
});
