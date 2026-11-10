/**
 * Suggest open tables whose verified capacity fits a party.
 * Unverified seat counts are never treated as a fit.
 * A recommendation is not a guaranteed hold or release time.
 */

export function recommendTables({ tables = [], reservations = [], partySize, section = null } = {}) {
  const party = Number(partySize);
  if (!Number.isFinite(party) || party < 1) {
    return { ok: false, reason: "party_size_required", recommendations: [], skippedUnverified: 0, writes: 0 };
  }
  const upcoming = reservations.filter((row) => ["booked", "arrived", "seated"].includes(row.status) && row.tableId);
  const recommendations = [];
  let skippedUnverified = 0;
  tables.forEach((table) => {
    if (!table || table.removed || table.active === false) return;
    if (section && table.floorId !== section && table.zone !== section) return;
    if (table.status && table.status !== "open") return;
    const held = upcoming.find((row) => row.tableId === table.id);
    if (held) return;
    if (table.capacity !== "verified" || !Number.isFinite(table.minSeats) || !Number.isFinite(table.maxSeats)) {
      skippedUnverified += 1;
      return;
    }
    if (party < table.minSeats || party > table.maxSeats) return;
    recommendations.push({
      tableId: table.id,
      label: table.label,
      because: `Open, and verified for ${table.minSeats} to ${table.maxSeats} covers.`,
    });
  });
  return { ok: true, recommendations, skippedUnverified, writes: 0 };
}
