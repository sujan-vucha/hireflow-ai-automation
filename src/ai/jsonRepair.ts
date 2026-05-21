export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("AI returned an empty response.");

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) {
    try {
      JSON.parse(fenced);
      return fenced;
    } catch {
      // Continue with brace extraction.
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const objectText = trimmed.slice(start, end + 1);
    JSON.parse(objectText);
    return objectText;
  }

  throw new Error("AI response did not contain a valid JSON object.");
}

export function parseJsonWithRepair<T>(text: string): T {
  return JSON.parse(extractJsonObject(text)) as T;
}
