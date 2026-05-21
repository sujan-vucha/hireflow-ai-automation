import { createGenericAdapter, defaultSearchUrl } from "./generic.adapter.js";

export const kornFerryAdapter = createGenericAdapter({
  siteId: "kornferry",
  siteName: "Korn Ferry",
  baseUrl: "https://kornferry.tal.net",
  crawlMode: "playwright",
  buildSearchUrl(input) {
    return defaultSearchUrl("https://kornferry.tal.net/candidate/jobboard/vacancy/3/adv", {
      keyword: input.title,
      location: input.location
    });
  }
});

