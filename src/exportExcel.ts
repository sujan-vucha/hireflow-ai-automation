import fs from "fs";
import path from "path";
import xlsx from "xlsx";

const datasetPath = path.join("storage", "datasets", "default");

function readDatasetItems(): any[] {
  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset folder not found: ${datasetPath}`);
    return [];
  }

  const files = fs.readdirSync(datasetPath).filter((file) => file.endsWith(".json"));
  const rows: any[] = [];

  for (const file of files) {
    const fullPath = path.join(datasetPath, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      rows.push(parsed);
    } catch {
      // ignore
    }
  }

  return rows;
}

const rows = readDatasetItems();

if (rows.length === 0) {
  console.log("No Crawlee dataset rows found. Run a scraper first.");
  process.exit(0);
}

const normalizedRows = rows.map((row) => ({
  "Source Site": row.sourceSite || "",
  "Job Title": row.title || "",
  "Company": row.company || "",
  "Location": row.location || "",
  "Employment Type": row.employmentType || "",
  "Salary": row.salary || "",
  "Currency": row.currency || "",
  "Posted Date": row.postedDate || "",
  "Valid Through": row.validThrough || "",
  "Recruiter Name": row.recruiterName || "",
  "Recruiter Email": row.recruiterEmail || "",
  "Recruiter Phone": row.recruiterPhone || "",
  "Apply Link": row.jobUrl || "",
  "Description": row.description || "",
  "Scraped At": row.scrapedAt || ""
}));

fs.mkdirSync("output", { recursive: true });

const workbook = xlsx.utils.book_new();
const worksheet = xlsx.utils.json_to_sheet(normalizedRows);
xlsx.utils.book_append_sheet(workbook, worksheet, "Jobs");

const outputPath = path.join("output", "jobs-export.xlsx");
xlsx.writeFile(workbook, outputPath);

console.log(`Exported ${normalizedRows.length} rows to ${outputPath}`);
