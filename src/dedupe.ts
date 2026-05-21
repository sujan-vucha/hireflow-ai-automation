import fs from "fs";
import path from "path";

const datasetPath = path.join("storage", "datasets", "default");
const reedPath = path.join("output", "reed-jobs.json");

function getKey(row: any): string {
  return [
    row.jobUrl || "",
    row.title || "",
    row.company || "",
    row.location || ""
  ]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readCrawleeRows(): any[] {
  if (!fs.existsSync(datasetPath)) return [];

  const files = fs.readdirSync(datasetPath).filter((file) => file.endsWith(".json"));
  const rows: any[] = [];

  for (const file of files) {
    try {
      rows.push(JSON.parse(fs.readFileSync(path.join(datasetPath, file), "utf-8")));
    } catch {}
  }

  return rows;
}

function readReedRows(): any[] {
  if (!fs.existsSync(reedPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(reedPath, "utf-8"));
  } catch {
    return [];
  }
}

const allRows = [...readCrawleeRows(), ...readReedRows()];
const seen = new Set<string>();
const deduped: any[] = [];

for (const row of allRows) {
  const key = getKey(row);
  if (!key || seen.has(key)) continue;

  seen.add(key);
  deduped.push(row);
}

fs.mkdirSync("output", { recursive: true });

const outPath = path.join("output", "jobs-deduped.json");
fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));

console.log(`Input rows: ${allRows.length}`);
console.log(`Deduped rows: ${deduped.length}`);
console.log(`Saved to ${outPath}`);
