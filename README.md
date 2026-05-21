# UK Recruitment Job Scraper

Production-oriented Node.js + TypeScript scraper for UK recruitment agency jobs. It searches public job pages and official APIs by job title, location, and date range, then exports normalized results to Excel and JSON.

The scraper is designed around this rule: collect all matching public jobs inside the selected date window, without inventing rows or bypassing access controls.

## Legal And Safety Rules

- Scrape public job data only.
- Do not bypass login pages, paywalls, CAPTCHA, private pages, or access controls.
- Do not use CAPTCHA solving services.
- If a site blocks access, report `BLOCKED_OR_RESTRICTED`, `CAPTCHA_DETECTED`, or `LOGIN_REQUIRED` and continue to the next site.
- If recruiter name, email, or phone is not publicly shown, store `Not publicly available`.
- Do not infer or generate fake contact data.
- Hays email pattern handling is metadata only: if a public email is not shown, `recruiterEmail` stays `Not publicly available`; the known pattern is stored separately in `Recruiter Email Pattern`.

## Install

```bash
npm install
npx playwright install chromium
```

Create an environment file if you want Reed API support:

```bash
copy .env.example .env
```

Add your Reed API key:

```env
REED_API_KEY=your_reed_api_key_here
```

If `REED_API_KEY` is missing, Reed returns `API_KEY_MISSING` and the all-sites run continues.

## Free Local AI With Ollama

The scraper can use Ollama for free local AI title expansion, semantic relevance scoring, and optional resume/job matching. AI never invents jobs or overwrites scraped job data; it only generates search terms and separate scoring fields.

Install Ollama:

```bash
# Download and install Ollama from https://ollama.com
ollama pull qwen3:8b
ollama run qwen3:8b
```

Configure `.env`:

```env
LOCAL_AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3:8b
OLLAMA_BASE_URL=http://127.0.0.1:11434
AI_EXPAND_DEFAULT=true
MAX_EXPANDED_TITLES=20
MIN_RELEVANCE_SCORE=70
```

If Ollama is unavailable, the scraper uses a static fallback title map and continues.

Run AI expansion across all sites:

```bash
npm run scrape -- --all --title="Digital Marketing" --days=7 --location="United Kingdom" --aiExpand=true
```

Run strict exact-title mode without expansion:

```bash
npm run scrape -- --all --title="Digital Marketing Manager" --days=7 --location="United Kingdom" --strictTitle=true
```

Test title expansion only:

```bash
npm run test:ai -- "Digital Marketing"
```

Test Hays with AI expansion:

```bash
npm run test:hays-ai
```

`APIFY_TOKEN` can also be stored in `.env` for future hosted scraper integration. The current production scraper still uses the local public-page Playwright/Cheerio adapters.

## Main Commands

Run a quick Hays test with a small page cap:

```bash
npm run scrape -- --site=hays --title="Digital Marketing Consultant" --days=7 --location="United Kingdom" --maxPages=2
```

Run Hays without the debug page cap when you want the full available public inventory:

```bash
npm run scrape -- --site=hays --title="Digital Marketing Consultant" --days=7 --location="United Kingdom"
```

Run an Apify-style broad Hays role-family search for jobs posted in the past 24 hours:

```bash
npm run scrape -- --site=hays --title="Digital Marketing Consultant / Growth Strategy / Analytics / Performance Media" --days=1 --location="United Kingdom" --maxJobs=400
```

Run the same search with local Ollama/fallback semantic relevance scoring, strict title filtering, and URL validation:

```bash
npm run scrape -- --site=hays --title="Digital Marketing Consultant / Growth Strategy / Analytics / Performance Media" --days=1 --location="United Kingdom" --maxJobs=400 --resume="C:\Users\shrut\Downloads\Prashant_Kumar_ATS_Resume_Digital.pdf" --minRelevanceScore=70 --strictTitle=true --strictKeyword=true --validateUrls=true
```

Run the same resume-matched search across all configured sites for the last 10 days:

```bash
npm run scrape -- --all --title="Digital Marketing Consultant / Growth Strategy / Analytics / Performance Media" --days=10 --location="United Kingdom" --resume="C:\Users\shrut\Downloads\Prashant_Kumar_ATS_Resume_Digital.pdf" --minRelevanceScore=70 --strictTitle=true --strictKeyword=true --validateUrls=true
```

Run every configured site:

```bash
npm run scrape -- --all --title="Digital Marketing Consultant" --days=7 --location="United Kingdom" --maxPages=1
```

Run CV-Library:

```bash
npm run scrape -- --site=cvlibrary --title="Digital Marketing Consultant" --days=7 --location="United Kingdom" --maxPages=1
```

Open the React results and scraper dashboard:

```bash
npm run dashboard
```

Then open:

```text
http://127.0.0.1:4317
```

Site names are normalized, so `cv-library`, `cv_library`, and `cvlibrary` resolve to the same adapter.

## CLI Options

| Option | Required | Description |
|---|---:|---|
| `--site=hays` | Required unless `--all` is used | Runs one adapter. |
| `--all` | Required unless `--site` is used | Runs all configured adapters and continues if one fails. |
| `--title="..."` | Yes | Keyword/job title to search for. |
| `--location="..."` | No | Defaults to `United Kingdom`. |
| `--days=7` | No | Defaults to `7`; date range is today minus selected days through today. |
| `--fromDate=YYYY-MM-DD` | No | Overrides calculated start date. |
| `--toDate=YYYY-MM-DD` | No | Overrides calculated end date. |
| `--headless=true` | No | Defaults to `true`; set `false` for browser debugging. |
| `--maxPages=2` | No | Optional safety/debug cap. Omit for normal runs. |
| `--maxJobs=50` | No | Optional safety/debug cap. Default is unlimited until pages/date range are exhausted. |
| `--output=excel` | No | Accepted for compatibility. The production scraper writes Excel, jobs JSON, and status JSON for auditability. |
| `--resume="./resume.pdf"` | No | Reads a PDF, TXT, MD, or JSON resume for match scoring. |
| `--minMatchScore=70` | No | Keeps only jobs with this resume/role match score or higher. |
| `--strictKeyword=true` | No | Applies a second strict keyword filter after the site's own search. Defaults to `false` so LLM/resume scoring can rank broader public candidates. |
| `--strictTitle=true` | No | Keeps only jobs whose public job title matches the exact target role. Defaults to `false` when AI expansion is used. |
| `--aiExpand=true` | No | Expands broad titles with Ollama or static fallback titles. Defaults to `true`. Disabled when `--strictTitle=true`. |
| `--maxExpandedTitles=20` | No | Maximum related titles generated for AI expansion. |
| `--minRelevanceScore=70` | No | Keeps only jobs whose semantic relevance score is at least this value. |
| `--aiProvider=ollama` | No | Uses Ollama when available. Use `fallback` to force the static fallback title map/scorer. |
| `--validateUrls=true` | No | Checks exported job/apply URLs and removes jobs whose detail URL is missing, malformed, HTTP error, closed, expired, or not found. Defaults to `true`. |
| `--scraper=apify` | No | Reserved flag. Current run still uses local public-page adapters. |

## Package Scripts

```json
{
  "scrape": "tsx src/scrape.ts",
  "dashboard": "npm run dashboard:build && tsx src/dashboard/server.ts",
  "dashboard:server": "tsx src/dashboard/server.ts",
  "dashboard:build": "vite build --config src/dashboard/vite.config.ts",
  "dashboard:dev": "vite --config src/dashboard/vite.config.ts",
  "crawl": "tsx src/main.ts",
  "reed": "tsx src/adapters/reed.adapter.ts",
  "discover": "tsx src/core/networkDiscovery.ts",
  "test:hays": "tsx src/scrape.ts --site=hays --title=\"Digital Marketing Consultant\" --days=7 --location=\"United Kingdom\" --maxPages=2",
  "test:cvlibrary": "tsx src/scrape.ts --site=cvlibrary --title=\"Digital Marketing Consultant\" --days=7 --location=\"United Kingdom\" --maxPages=1",
  "test:all": "tsx src/scrape.ts --all --title=\"Digital Marketing Consultant\" --days=7 --location=\"United Kingdom\" --maxPages=1"
}
```

`npm run crawl` is the older starter crawler. Use `npm run scrape` for the upgraded production workflow.

## Output Files

Every `npm run scrape` run creates timestamped outputs:

```text
output/jobs-{timestamp}.xlsx
output/jobs-{timestamp}.json
output/status-{timestamp}.json
output/ai-expansion-{timestamp}.json
output/status/{siteId}.json
```

Network discovery saves:

```text
output/network-discovery/{siteId}.json
```

Excel sheets:

- `All Jobs`
- `High Confidence Jobs`
- `Missing Recruiter`
- `Site Status`
- `Errors`
- `AI Expansion Report`

Main Excel columns:

- `Job Title`
- `Company / Hays Division`
- `Location`
- `Work Type (Full-time / Contract / Temp)`
- `Posted Date`
- `Resume Match Score (%)`
- `Original Search Title`
- `Matched Search Title`
- `AI Expanded Title Used`
- `AI Provider Used`
- `AI Mode`
- `Role Category`
- `Semantic Relevance Score`
- `Semantic Match Type`
- `Semantic Match Reason`
- `Key Matching Skills`
- `Why Strong Fit`
- `Apply Link`
- `HR Recruiter Name`
- `HR Contact Email`
- `HR Contact Email Pattern`
- `Job Code`
- `Application Status`
- `Mobile NO.`
- `Source Site`
- `Company`
- `Agency`
- `Salary`
- `Job Type`
- `Job Function`
- `Sector`
- `Subsector`
- `Contract Type`
- `Work Pattern`
- `Posted Date`
- `Closing Date`
- `Recruiter Name`
- `Recruiter Email`
- `Recruiter Email Source`
- `Recruiter Email Pattern`
- `Recruiter Phone`
- `Apply URL`
- `Job URL`
- `Source Job ID`
- `Description`
- `Key Skills`
- `Match Score Source`
- `Match Gaps`
- `Site Specific Fields`
- `Extraction Confidence`
- `Missing Fields`
- `Scraped At`

`Site Specific Fields` is a JSON string containing fields that differ by website, such as Hays specialism, Michael Page job summary fields, CV-Library advertiser, or Morgan Hunt consultant data.

`Resume Match Score (%)` is a role/keyword fit score by default. When `--resume` is used and Ollama is running, it becomes a local Ollama resume-fit score based on the resume and public job text. If Ollama is unavailable, fallback keyword scoring is used.

## React Dashboard

Start the dashboard:

```bash
npm run dashboard
```

Default URL:

```text
http://127.0.0.1:4317
```

Optional custom port:

```bash
npm run dashboard -- --port=4320
```

The dashboard reads `output/jobs-*.json`, `output/status-*.json`, and matching Excel files. It shows:

- scrape form for launching new runs from the browser
- live scrape logs and running/completed/failed state
- run selector for previous scrape runs
- summary metrics
- source, location, score, skill, warning, and error analytics
- site status table
- searchable/filterable job table
- job detail drawer
- Excel and JSON downloads
- local Pending/Done tracking stored in browser local storage
- filtered CSV export

Dashboard scrape controls support the same core options as the CLI:

```text
site/all, title, location, days, maxPages, maxJobs, resume path, minMatchScore, headless, strictKeyword, strictTitle, validateUrls
```

The dashboard starts the same legal public-page scraper used by `npm run scrape`; it does not bypass CAPTCHA, login, paywalls, or private pages.

## Site Status Values

```text
SUCCESS
SUCCESS_WITH_WARNINGS
NO_MATCHING_JOBS
LOW_INVENTORY
ALL_AVAILABLE_SCRAPED
BLOCKED_OR_RESTRICTED
CAPTCHA_DETECTED
LOGIN_REQUIRED
API_KEY_MISSING
SITE_ERROR
SELECTOR_FAILURE
PARTIAL_SUCCESS
```

The scraper does not stop the whole run when one site fails. It writes the failed site's status and continues.

## Supported Sites

| Site ID | Website | Current Strategy | Site-Specific Extraction |
|---|---|---|---|
| `hays` | Hays UK | Playwright search and detail extraction | Job reference, job type, working pattern, specialism, industry, pay, consultant name/phone when public, Hays email pattern metadata only. |
| `cvlibrary` | CV-Library | Public search pages with Playwright detail fallback | CV-Library job ID, advertiser, salary/rate, job type. |
| `michaelpage` | Michael Page UK | Playwright with detail-page extraction | Full sections: highlights, About Our Client, Job Description, The Successful Applicant, What's on Offer, Contact, Job summary, consultant, phone, job reference, function, sector, subsector. |
| `reed` | Reed | Official Reed API | API fields mapped to normalized job records. Requires `REED_API_KEY`. |
| `randstad` | Randstad UK | Cheerio first, Playwright fallback | Generic public job detail extraction; selectors may need more tuning if the site changes. |
| `robertwalters` | Robert Walters UK | Cheerio first, Playwright fallback | Often protected by human verification; reports block/CAPTCHA instead of bypassing. |
| `adecco` | Adecco UK | Playwright and network discovery path | Generic extraction plus public page details where accessible. |
| `manpower` | Manpower UK | Playwright detail extraction | Job type, salary, industry, hours, location, Manpower job ID where public. |
| `roberthalf` | Robert Half UK | Playwright detail extraction | Job reference, staffing area, posted text, employment type, salary text. |
| `pageexecutive` | Page Executive | Playwright | Generic Page-style extraction; can be extended with Michael Page-style summary selectors. |
| `kornferry` | Korn Ferry | Playwright and network discovery path | Generic public job detail extraction. |
| `tiger` | Tiger Recruitment | Cheerio first, Playwright fallback | May return geographic/security restrictions; reports restricted status. |
| `morganhunt` | Morgan Hunt | Cheerio with custom detail extraction | Job ref, client, sector, job type, consultant name/role/email when publicly shown. |
| `huntress` | Huntress | Cheerio first, Playwright fallback | Generic public job detail extraction. |
| `jac` | JAC Recruitment UK | Playwright with custom detail extraction | Reference, specialisation, company, job published date, public contact email. |
| `propel` | Propel | Cheerio first, Playwright fallback | Generic public job detail extraction. |

## Data Extraction Order

The extractor uses layered fallbacks and never invents missing values.

Title:

1. JSON-LD `JobPosting.title`
2. Detail page `h1`
3. `og:title`
4. Listing-card title

Posted date:

1. JSON-LD `datePosted`
2. Visible `Posted on` / `Date posted` text
3. Listing-card date
4. Date regex from page text

Salary:

1. JSON-LD `baseSalary`
2. Visible salary block
3. Pound-amount regex from page text

Location:

1. JSON-LD `jobLocation`
2. Visible location fields
3. Listing-card location
4. Obvious text fallback

Recruiter:

1. Consultant/contact sections
2. Author/recruiter blocks
3. Public `mailto:` links
4. Named contact near public email/phone
5. `Not publicly available`

Description:

1. JSON-LD description
2. Site-specific job description sections
3. `article` / `main` content
4. Cleaned body text, safely truncated

## Date Parsing

Supported examples:

```text
today
yesterday
just posted
posted today
1 day ago
2 days ago
7 days ago
2 weeks ago
3 hours ago
dd/mm/yyyy
dd-mm-yyyy
yyyy-mm-dd
10 May 2026
May 10, 2026
Posted on 10 May
Closing date 10 May 2026
```

## Network Discovery

Use network discovery only to inspect public unauthenticated job endpoints. Do not use private, authenticated, or access-controlled endpoints.

```bash
npm run discover -- --site=michaelpage
npm run discover -- --site=adecco
npm run discover -- --url=https://example.com/jobs
```

It logs public network calls containing terms such as `job`, `jobs`, `search`, `vacancy`, `api`, `graphql`, `solr`, or `elastic`, and saves them to `output/network-discovery/{siteId}.json`.

## Troubleshooting

`API_KEY_MISSING`: Reed API key is not configured. Add `REED_API_KEY` to `.env`.

`CAPTCHA_DETECTED` or `BLOCKED_OR_RESTRICTED`: the site blocked or challenged access. The scraper records the status and does not bypass it.

`LOGIN_REQUIRED`: the page is login-only. The scraper does not continue on private pages.

`NO_MATCHING_JOBS`: no public listings matched the title, location, and date range.

`LOW_INVENTORY`: fewer jobs were publicly available than expected for that search.

`SELECTOR_FAILURE`: the site layout likely changed or the current selectors did not find usable job detail data.

Cookie banners or normal `sign in` links should not stop the scraper by themselves. The safety check only blocks hard access-control pages or true login-only pages.

## Development Notes

Core files:

```text
src/scrape.ts
src/config/sites.ts
src/adapters/*.adapter.ts
src/core/types.ts
src/core/safety.ts
src/core/dateParser.ts
src/core/jobExtractor.ts
src/core/normalize.ts
src/core/dedupe.ts
src/core/exportExcel.ts
src/core/networkDiscovery.ts
src/core/statusReporter.ts
```

Run a type check:

```bash
npx tsc --noEmit
```

Useful smoke tests:

```bash
npm run test:hays
npm run test:cvlibrary
npm run test:all
```

For production accuracy, keep improving individual adapters with live page-specific selectors. Each recruitment site exposes different detail fields, so important non-standard fields should go into `siteSpecificFields` and the Excel `Site Specific Fields` column.
#   j o b - s c r a p e r - p o r t a l  
 