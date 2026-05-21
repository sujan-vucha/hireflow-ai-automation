const DAY_MS = 24 * 60 * 60 * 1000;

const monthMap: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function calculateDateRange(days: number): { fromDate: string; toDate: string } {
  const today = startOfDay(new Date());
  const from = new Date(today.getTime() - Math.max(days, 0) * DAY_MS);
  return {
    fromDate: formatDate(from),
    toDate: formatDate(today)
  };
}

export function isWithinDateRange(dateValue: string, fromDate: string, toDate: string): boolean {
  if (!dateValue) return false;
  const date = new Date(`${dateValue}T00:00:00`);
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T23:59:59`);
  if (Number.isNaN(date.getTime())) return false;
  return date >= from && date <= to;
}

export function parsePostedDate(raw?: string | null, referenceDate = new Date()): string {
  if (!raw) return "";

  const text = raw
    .replace(/\u00a0/g, " ")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const lower = text.toLowerCase();
  const today = startOfDay(referenceDate);

  if (/\b(just posted|posted today|today)\b/.test(lower)) return formatDate(today);
  if (/\byesterday\b/.test(lower)) return formatDate(new Date(today.getTime() - DAY_MS));

  const ago = lower.match(/\b(\d{1,3})\s+days?\s+ago\b/);
  if (ago) return formatDate(new Date(today.getTime() - Number(ago[1]) * DAY_MS));

  const hoursAgo = lower.match(/\b(\d{1,3})\s+(?:hours?|minutes?|mins?)\s+ago\b/);
  if (hoursAgo) return formatDate(today);

  const weeksAgo = lower.match(/\b(\d{1,3})\s+weeks?\s+ago\b/);
  if (weeksAgo) return formatDate(new Date(today.getTime() - Number(weeksAgo[1]) * 7 * DAY_MS));

  const monthsAgo = lower.match(/\b(\d{1,3})\s+months?\s+ago\b/);
  if (monthsAgo) return formatDate(new Date(today.getTime() - Number(monthsAgo[1]) * 30 * DAY_MS));

  const iso = lower.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/);
  if (iso) {
    return formatDate(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  const uk = lower.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?!\d)/);
  if (uk) {
    return formatDate(new Date(Number(uk[3]), Number(uk[2]) - 1, Number(uk[1])));
  }

  const dayMonthYear = lower.match(
    /\b(?:posted on |date posted |closing date |posted )?(\d{1,2})\s+([a-z]{3,9})(?:\s+(20\d{2}))?\b/
  );
  if (dayMonthYear && monthMap[dayMonthYear[2]] !== undefined) {
    return formatDate(
      new Date(
        dayMonthYear[3] ? Number(dayMonthYear[3]) : today.getFullYear(),
        monthMap[dayMonthYear[2]],
        Number(dayMonthYear[1])
      )
    );
  }

  const monthDayYear = lower.match(/\b([a-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (monthDayYear && monthMap[monthDayYear[1]] !== undefined) {
    return formatDate(
      new Date(Number(monthDayYear[3]), monthMap[monthDayYear[1]], Number(monthDayYear[2]))
    );
  }

  return "";
}
