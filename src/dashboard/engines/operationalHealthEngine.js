/**
 * Executive operational health — Healthy / Watch / Risk from menu + review signals.
 */

/**
 * @param {{
 *   sessions?: number,
 *   bouncePct?: number,
 *   deepPct?: number,
 *   addOnRate?: number,
 *   returningPct?: number,
 *   reviewConversionPct?: number,
 *   avgTimeSpent?: number,
 *   itemOpens?: number,
 * }} input
 */
export function assessOperationalHealth(input = {}) {
  const sessions = Number(input.sessions) || 0;
  const bouncePct = Number(input.bouncePct) || 0;
  const deepPct = Number(input.deepPct) || 0;
  const addOnRate = Number(input.addOnRate) || 0;
  const returningPct = Number(input.returningPct) || 0;
  const reviewConversionPct = Number(input.reviewConversionPct) || 0;
  const avgTimeSpent = Number(input.avgTimeSpent) || 0;
  const itemOpens = Number(input.itemOpens) || 0;

  if (sessions < 5) {
    return {
      status: "watch",
      label: "Watch",
      explanation:
        "Limited session volume in this period. Check again after more guest traffic before making operational changes.",
    };
  }

  let riskPoints = 0;
  let watchPoints = 0;

  if (bouncePct >= 45) riskPoints += 2;
  else if (bouncePct >= 32) watchPoints += 1;

  if (deepPct < 8 && sessions >= 20) watchPoints += 1;
  if (deepPct < 4 && sessions >= 40) riskPoints += 1;

  if (addOnRate < 4 && itemOpens >= 30) watchPoints += 1;
  if (addOnRate < 2 && itemOpens >= 50) riskPoints += 1;

  if (returningPct < 8 && sessions >= 30) watchPoints += 1;

  if (reviewConversionPct > 0) {
    if (reviewConversionPct < 8) riskPoints += 1;
    else if (reviewConversionPct < 15) watchPoints += 1;
  }

  if (avgTimeSpent > 0 && avgTimeSpent < 25 && sessions >= 25) watchPoints += 1;

  if (riskPoints >= 2) {
    return {
      status: "risk",
      label: "Risk",
      explanation:
        "Guest engagement is weak: high bounce, low depth, or review conversion is slipping. Prioritize menu clarity, staffing presence, and review QR follow-through today.",
    };
  }

  if (watchPoints >= 2 || riskPoints === 1) {
    return {
      status: "watch",
      label: "Watch",
      explanation:
        "Traffic is present but conversion signals are mixed. Monitor category opens, item interest, and review redirects during the next service period.",
    };
  }

  return {
    status: "healthy",
    label: "Healthy",
    explanation:
      "Guests are browsing with reasonable depth, add-on interest, and review flow. Keep current floor rhythm and menu positioning.",
  };
}
