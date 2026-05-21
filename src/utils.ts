export const normalizeText = (text?: string | null): string =>
  text?.replace(/\s+/g, " ").trim() || "";

export function looksLikeJobUrl(url: string): boolean {
  const u = url.toLowerCase();

  const negativePatterns = [
    "/blog",
    "/news",
    "/salary",
    "/contact",
    "/about",
    "/privacy",
    "/terms",
    "/cookies",
    "/login",
    "/register",
    "/candidate",
    "/employer"
  ];

  if (negativePatterns.some((pattern) => u.includes(pattern))) return false;

  return (
    u.includes("/job") ||
    u.includes("/jobs/") ||
    u.includes("/vacancy") ||
    u.includes("/vacancies") ||
    u.includes("/job-detail") ||
    u.includes("/job-search/")
  );
}

export function extractRecruiterName(text: string): string {
  const patterns = [
    /consultant\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
    /recruiter\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
    /contact\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
    /speak\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeText(match[1]);
  }

  return "";
}

export function extractEmail(text: string): string {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] || "";
}

export function extractPhone(text: string): string {
  const match = text.match(/(?:\+44|0)\s?\d{2,5}\s?\d{3,4}\s?\d{3,4}/);
  return match?.[0] || "";
}
