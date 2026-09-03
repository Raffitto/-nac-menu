export function eachIsoDateInclusive(from, to) {
  const dates = [];
  if (!from || !to || from > to) return dates;
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function missingDates(haveSet, from, to) {
  return eachIsoDateInclusive(from, to).filter((d) => !haveSet.has(d));
}

export function batchCoversRange(batch, from, to) {
  if (!batch?.period_start || !batch?.period_end) return false;
  return batch.period_start <= from && batch.period_end >= to;
}

export function unionCoverage(batches, from, to) {
  const have = new Set();
  (batches || []).forEach((b) => {
    if (!b?.period_start || !b?.period_end) return;
    eachIsoDateInclusive(b.period_start, b.period_end).forEach((d) => have.add(d));
  });
  const missing = missingDates(have, from, to);
  return { complete: missing.length === 0, missing };
}
