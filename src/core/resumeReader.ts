import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";
import { normalizeText } from "./normalize.js";

export async function readResumeText(resumePath: string): Promise<string> {
  const absolutePath = path.resolve(resumePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Resume file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (ext === ".pdf") {
    const buffer = fs.readFileSync(absolutePath);
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return normalizeText(result.text);
  }

  if ([".txt", ".md", ".markdown", ".json"].includes(ext)) {
    return normalizeText(fs.readFileSync(absolutePath, "utf8"));
  }

  throw new Error(`Unsupported resume file type "${ext}". Use .pdf, .txt, .md, or .json.`);
}
