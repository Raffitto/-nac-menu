/**
 * Parse Foodics date ranges from natural language (calendar months / relative periods).
 */

const MONTH_MAP = Object.freeze({
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
});

function pad2(n) {
  return String(n).padStart(2, "0");
}

function monthBounds(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const startDate = `${year}-${pad2(monthIndex + 1)}-01`;
  const endDate = `${year}-${pad2(monthIndex + 1)}-${pad2(lastDay)}`;
  const label = new Date(Date.UTC(year, monthIndex, 1, 12)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { startDate, endDate, label };
}

function shiftMonth(year, monthIndex, delta) {
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
}

function parseNamedMonth(q, referenceDate = new Date()) {
  const match = q.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\b(?:\s+(20\d{2}))?/,
  );
  if (!match) return null;

  const monthIndex = MONTH_MAP[match[1]];
  let year = match[2] ? Number(match[2]) : referenceDate.getFullYear();

  if (!match[2]) {
    const refMonth = referenceDate.getMonth();
    if (monthIndex > refMonth) year -= 1;
  }

  return monthBounds(year, monthIndex);
}

/** Primary Foodics period referenced in a question. */
export function parseFoodicsPeriodFromQuestion(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase();

  if (/\b(this month|month to date|month-to-date|mtd)\b/.test(q)) {
    const y = referenceDate.getFullYear();
    const m = referenceDate.getMonth();
    return monthBounds(y, m);
  }

  if (/\blast month\b/.test(q)) {
    const shifted = shiftMonth(referenceDate.getFullYear(), referenceDate.getMonth(), -1);
    return monthBounds(shifted.year, shifted.monthIndex);
  }

  const named = parseNamedMonth(q, referenceDate);
  if (named) return named;

  if (/\b(last 7|7d|7 days|past week|this week)\b/.test(q)) {
    const end = referenceDate.toISOString().slice(0, 10);
    const startDate = new Date(referenceDate.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    return { startDate, endDate: end, label: "Last 7 days" };
  }

  return null;
}

/** Current + previous period for rank/compare questions. */
export function parseFoodicsComparePeriods(question = "", referenceDate = new Date()) {
  const q = String(question || "").toLowerCase();
  let current = null;

  if (/\b(this month|month to date|month-to-date|mtd)\b/.test(q)) {
    current = monthBounds(referenceDate.getFullYear(), referenceDate.getMonth());
  } else if (/\blast month\b/.test(q)) {
    const shifted = shiftMonth(referenceDate.getFullYear(), referenceDate.getMonth(), -1);
    current = monthBounds(shifted.year, shifted.monthIndex);
  } else {
    current = parseNamedMonth(q, referenceDate) || monthBounds(referenceDate.getFullYear(), referenceDate.getMonth());
  }

  const [cy, cm] = current.startDate.split("-").map(Number);
  const shifted = shiftMonth(cy, cm - 1, -1);
  const previous = monthBounds(shifted.year, shifted.monthIndex);

  return { current, previous };
}

export function detectRankingBasis(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(by quantity|quantity|units sold|qty|rank.*quantity|quantity instead|sells most|best selling|top selling|most popular)\b/.test(q)) {
    return "quantity";
  }
  return "net_sales";
}

export function detectTopLimit(question = "", fallback = 10) {
  const q = String(question || "").toLowerCase();
  const match = q.match(/\btop\s+(\d{1,2})\b/);
  if (match) return Math.min(25, Math.max(1, Number(match[1])));
  if (/\btop ten\b/.test(q)) return 10;
  return fallback;
}

export function detectRankChangeDirection(question = "") {
  const q = String(question || "").toLowerCase();
  if (/\b(entered|joined|new in|moved into)\b.*\btop\b/.test(q)) return "entered";
  if (/\b(dropped|fell|left|removed from)\b.*\btop\b/.test(q)) return "dropped";
  if (/\bentered\b/.test(q)) return "entered";
  if (/\bdropped\b/.test(q)) return "dropped";
  return "both";
}
