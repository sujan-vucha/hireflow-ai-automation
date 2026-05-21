export const selectors = {
  title: [
    "h1",
    '[data-testid*="title"]',
    '[class*="job-title"]',
    '[class*="jobTitle"]',
    '[class*="title"]'
  ],
  description: [
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[id*="description"]',
    "article",
    "main"
  ],
  location: [
    '[data-testid*="location"]',
    '[class*="location"]',
    '[id*="location"]'
  ],
  salary: [
    '[data-testid*="salary"]',
    '[class*="salary"]',
    '[id*="salary"]',
    '[class*="pay"]'
  ],
  recruiter: [
    '[class*="consultant"]',
    '[class*="recruiter"]',
    '[class*="contact"]',
    '[id*="consultant"]',
    '[id*="contact"]'
  ],
  postedDate: [
    '[data-testid*="date"]',
    '[class*="posted"]',
    '[class*="date"]',
    "time"
  ]
};

