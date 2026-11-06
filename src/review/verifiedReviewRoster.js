/** Printed-card identities supplement review activity without creating database staff IDs. */
import cards from "./all15ReleaseCards.json";
import { staffNameForTracking } from "./reviewGeneratorShared";
import { normalizeReviewBranchId } from "./reviewBranchIdentity";

function identityKey(branch, name) {
  const normalizedName = staffNameForTracking(name);
  return `${normalizeReviewBranchId(branch) || "unknown"}::${String(normalizedName || "").toLowerCase()}`;
}

export function withVerifiedReviewRoster(staffRows = [], allowedBranchIds = []) {
  const allowed = new Set((allowedBranchIds || []).map(normalizeReviewBranchId).filter(Boolean));
  const rows = (staffRows || []).map((row) => ({ ...row }));
  const byIdentity = new Map(rows.map((row) => [identityKey(row.branch, row.name), row]));

  for (const card of cards) {
    if (!allowed.has(card.branch_id)) continue;
    const key = identityKey(card.branch_id, card.name);
    const existing = byIdentity.get(key);
    if (existing) {
      if (!existing.role) existing.role = card.role;
      continue;
    }
    const row = {
      name: card.name,
      role: card.role,
      branch: card.branch_id,
      scans: 0,
      review_opens: 0,
      generated: 0,
      copy: 0,
      google: 0,
      opens: 0,
      qr_visits: 0,
      converted_visits: 0,
      raw_qr_scans: 0,
      raw_google_redirects: 0,
      conversion_pct: null,
      identity_source: "printed_qr_url",
    };
    rows.push(row);
    byIdentity.set(key, row);
  }
  return rows.sort((a, b) => (Number(b.scans) || 0) - (Number(a.scans) || 0)
    || (Number(b.google) || 0) - (Number(a.google) || 0)
    || String(a.name).localeCompare(String(b.name)));
}
