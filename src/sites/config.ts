export type SiteConfig = {
  id: string;
  name: string;
  startUrls: string[];
  crawler: "cheerio" | "playwright" | "api";
  maxItems: number;
  notes: string;
};

export const sites: SiteConfig[] = [
  {
    id: "hays",
    name: "Hays UK",
    crawler: "cheerio",
    startUrls: ["https://www.hays.co.uk/job-search"],
    maxItems: 1000,
    notes: "Use job-search pages and open each detail page."
  },
  {
    id: "michaelpage",
    name: "Michael Page UK",
    crawler: "playwright",
    startUrls: ["https://www.michaelpage.co.uk/jobs"],
    maxItems: 1000,
    notes: "Use Playwright first because PageGroup pages often use dynamic loading/show-more patterns."
  },
  {
    id: "robertwalters",
    name: "Robert Walters UK",
    crawler: "cheerio",
    startUrls: ["https://www.robertwalters.co.uk/jobs.html"],
    maxItems: 1000,
    notes: "Start with HTML crawling, then open every job detail page."
  },
  {
    id: "reed",
    name: "Reed",
    crawler: "api",
    startUrls: [],
    maxItems: 1000,
    notes: "Use Reed official Jobseeker API, not scraping."
  },
  {
    id: "randstad",
    name: "Randstad UK",
    crawler: "cheerio",
    startUrls: ["https://www.randstad.co.uk/jobs/"],
    maxItems: 1000,
    notes: "HTML crawl should work for job listings and detail pages."
  },
  {
    id: "adecco",
    name: "Adecco UK",
    crawler: "playwright",
    startUrls: ["https://www.adecco.com/en-gb/jobs"],
    maxItems: 1000,
    notes: "Use Playwright and inspect Network/XHR for job API calls."
  },
  {
    id: "manpower",
    name: "Manpower UK",
    crawler: "playwright",
    startUrls: ["https://www.manpower.co.uk/en-gb/jobs"],
    maxItems: 1000,
    notes: "Use Playwright first; detect pagination or API endpoint from network calls."
  },
  {
    id: "pageexecutive",
    name: "Page Executive",
    crawler: "playwright",
    startUrls: ["https://www.pageexecutive.com/job-search"],
    maxItems: 1000,
    notes: "Same family style as Michael Page, but may have fewer than 1000 live jobs."
  },
  {
    id: "kornferry",
    name: "Korn Ferry",
    crawler: "playwright",
    startUrls: ["https://kornferry.tal.net/candidate/jobboard/vacancy/3/adv"],
    maxItems: 1000,
    notes: "Use the Tal.net ATS job board route."
  },
  {
    id: "roberthalf",
    name: "Robert Half UK",
    crawler: "cheerio",
    startUrls: ["https://www.roberthalf.com/gb/en/jobs"],
    maxItems: 1000,
    notes: "Open search pages and every detail page."
  },
  {
    id: "tiger",
    name: "Tiger Recruitment",
    crawler: "cheerio",
    startUrls: ["https://tiger-recruitment.com/jobs/"],
    maxItems: 1000,
    notes: "Scrape all available jobs; this agency may have fewer than 1000 live vacancies."
  },
  {
    id: "morganhunt",
    name: "Morgan Hunt",
    crawler: "cheerio",
    startUrls: ["https://www.morganhunt.com/jobs/search"],
    maxItems: 1000,
    notes: "Start with job search page and paginate."
  },
  {
    id: "huntress",
    name: "Huntress",
    crawler: "cheerio",
    startUrls: ["https://www.huntress.co.uk/jobs"],
    maxItems: 1000,
    notes: "Start with job search page; switch to Playwright only if pagination is JS-driven."
  },
  {
    id: "jac",
    name: "JAC Recruitment UK",
    crawler: "playwright",
    startUrls: ["https://www.jac-recruitment.co.uk/jobs"],
    maxItems: 1000,
    notes: "Use Playwright to detect job-search route/API."
  },
  {
    id: "propel",
    name: "Propel",
    crawler: "cheerio",
    startUrls: ["https://www.propel-together.com/job-search/"],
    maxItems: 1000,
    notes: "Propel job search uses page pagination, for example ?page=2."
  }
];
