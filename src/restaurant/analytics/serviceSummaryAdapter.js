/**
 * Read-only serviceSummary adapter.
 * Reads the shared restaurant snapshot. It does not reserve, seat, order, pay, or close.
 * Simulated records stay simulated. Missing clocks, covers, and walk-ins stay missing.
 * 0 is used only when the snapshot actually contains that count.
 */
import { assertServiceBranch, serviceSummary } from "../contracts";

export const SIMULATED_SERVICE = "simulated_service";
export const VERIFIED_OPERATIONAL = "verified_operational";
export const MIXED_ORIGIN = "mixed";

export const SERVICE_ANALYTICS_WRITES = 0;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function leaf(value, reason) {
  if (value == null) return { status: "missing", value: null, reason: reason || "not_recorded" };
  return { status: "available", value, reason: null };
}

function finite(value) {
  if (typeof value === "boolean" || value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function listOrMissing(value) {
  return Array.isArray(value) ? value : null;
}

function inBranch(row, branchId) {
  if (!row || typeof row !== "object") return false;
  if (row.branchId && row.branchId !== branchId) return false;
  return true;
}

function sameBranch(rows, branchId) {
  if (rows == null) return { rows: null, excluded: 0 };
  const kept = [];
  let excluded = 0;
  rows.forEach((row) => {
    if (inBranch(row, branchId)) kept.push(row);
    else excluded += 1;
  });
  return { rows: kept, excluded };
}

function explicitOrigin(record) {
  if (!record || typeof record !== "object") return null;
  if (record.simulated === true) return SIMULATED_SERVICE;
  const named = String(record.origin || record.dataOrigin || "").toLowerCase();
  if (named === VERIFIED_OPERATIONAL || named === "verified") return VERIFIED_OPERATIONAL;
  if (named === SIMULATED_SERVICE || named === "simulated") return SIMULATED_SERVICE;
  if (record.method === "simulated" || record.status === "simulated") return SIMULATED_SERVICE;
  return null;
}

function stamp(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 60000;
}

export function summarizeDurations(samples) {
  const values = (samples || []).filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
  if (!values.length) {
    return { status: "missing", count: 0, average: null, median: null, reason: "no_timed_samples" };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const average = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  return { status: "available", count: sorted.length, average, median, reason: null };
}

function durationReport(samples, untimed, missingReason) {
  const summary = summarizeDurations(samples);
  if (!summary.count && untimed > 0) {
    return { ...summary, status: "missing", untimed, reason: missingReason };
  }
  if (!summary.count) return { ...summary, untimed, reason: missingReason };
  if (untimed > 0) {
    return { ...summary, status: "partial", untimed, reason: "untimed_records_excluded" };
  }
  return { ...summary, untimed: 0 };
}

function collectDates(groups) {
  const dates = new Set();
  groups.forEach((rows) => {
    (rows || []).forEach((row) => {
      [row?.businessDate, row?.serviceDate].forEach((value) => {
        if (DATE_KEY.test(String(value || ""))) dates.add(String(value));
      });
    });
  });
  return [...dates].sort();
}

function reservationBucket(row) {
  const status = String(row?.status || "").toLowerCase();
  if (status === "cancelled" || status === "canceled" || row?.cancelled === true) return "cancelled";
  if (status === "no_show" || status === "no-show" || status === "noshow") return "noShow";
  if (status === "seated" || status === "completed" || status === "done") return "seated";
  if (status === "booked" || status === "confirmed" || status === "reserved") return "booked";
  return "other";
}

function walkInClass(row) {
  if (!row || typeof row !== "object") return "absent";
  const marked = "walkIn" in row || "channel" in row || "arrival" in row || "reservationType" in row;
  if (!marked) return "absent";
  if (row.walkIn === true) return "yes";
  const label = String(row.channel || row.arrival || row.reservationType || "").toLowerCase().replace(/[\s_-]/g, "");
  return label === "walkin" ? "yes" : "no";
}

function countWalkIns(reservations) {
  if (reservations == null) return leaf(null, "reservations_not_recorded");
  let yes = 0;
  let unmarked = 0;
  reservations.forEach((row) => {
    const klass = walkInClass(row);
    if (klass === "yes") yes += 1;
    else if (klass === "absent") unmarked += 1;
  });
  if (unmarked === reservations.length) return leaf(null, "walk_in_not_recorded");
  if (unmarked > 0) return { status: "missing", value: null, reason: "walk_in_incomplete", identified: yes, unmarked };
  return leaf(yes, null);
}

function coversOf(visit, reservationsById, sessionsById) {
  const direct = finite(visit?.covers);
  if (direct != null) return direct;
  const party = finite(visit?.partySize);
  if (party != null) return party;
  const session = sessionsById.get(visit?.sessionId);
  const reservation = reservationsById.get(visit?.reservationId) || reservationsById.get(session?.reservationId);
  return finite(reservation?.partySize);
}

function sumCovers(visits, reservationsById, sessionsById) {
  if (visits == null) return { ...leaf(null, "visits_not_recorded"), missingRows: null };
  if (!visits.length) return { ...leaf(0, null), missingRows: 0, known: 0 };
  let known = 0;
  let missingRows = 0;
  visits.forEach((visit) => {
    const covers = coversOf(visit, reservationsById, sessionsById);
    if (covers == null) missingRows += 1;
    else known += covers;
  });
  if (missingRows > 0) {
    return { status: "missing", value: null, reason: "covers_not_recorded_for_every_visit", missingRows, known };
  }
  return { ...leaf(known, null), missingRows: 0, known };
}

function indexById(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    if (row?.id) map.set(row.id, row);
  });
  return map;
}

function itemList(orders) {
  if (orders == null) return null;
  return orders.flatMap((order) => {
    if (!Array.isArray(order?.items)) return [];
    return order.items.map((item) => ({ item, orderId: item?.orderId || order.id }));
  });
}

function sumMoney(rows, pick) {
  if (rows == null) return leaf(null, "not_recorded");
  let total = 0;
  let missing = 0;
  rows.forEach((row) => {
    const amount = finite(pick(row));
    if (amount == null) missing += 1;
    else total += amount;
  });
  if (missing > 0) return { status: "missing", value: null, reason: "amount_not_recorded", missingRows: missing };
  return { ...leaf(total, null), missingRows: 0 };
}

function classifyPayment(payment, declared) {
  const origin = explicitOrigin(payment);
  if (origin === SIMULATED_SERVICE || payment?.method === "simulated" || payment?.status === "simulated") return "simulated";
  if (origin === VERIFIED_OPERATIONAL) return "real";
  if (declared === SIMULATED_SERVICE) return "simulated";
  if (declared === VERIFIED_OPERATIONAL && payment?.method && payment.method !== "simulated") return "real";
  return "unidentified";
}

function paymentTotals(payments, declared) {
  if (payments == null) {
    return {
      status: "missing",
      count: null,
      simulated: leaf(null, "payments_not_recorded"),
      simulatedAmount: leaf(null, "payments_not_recorded"),
      real: leaf(null, "payments_not_recorded"),
      realAmount: leaf(null, "payments_not_recorded"),
      unidentified: leaf(null, "payments_not_recorded"),
      reason: "payments_not_recorded",
    };
  }
  const groups = { simulated: [], real: [], unidentified: [] };
  payments.forEach((payment) => {
    groups[classifyPayment(payment, declared)].push(payment);
  });
  const amountOf = (rows) => sumMoney(rows, (row) => row.amount);
  return {
    status: "available",
    count: payments.length,
    simulated: leaf(groups.simulated.length, null),
    simulatedAmount: amountOf(groups.simulated),
    real: leaf(groups.real.length, null),
    realAmount: amountOf(groups.real),
    unidentified: leaf(groups.unidentified.length, null),
    reason: null,
  };
}

function delayEntry(orderId, itemId, delayMinutes, basis) {
  return { orderId: orderId || null, itemId: itemId || null, delayMinutes, basis };
}

function collectDelays({ orders, tickets, items, threshold, now }) {
  const rows = [
    ...(tickets || []).map((row) => ({ row, orderId: row.orderId, itemId: null })),
    ...(items || []).map(({ item, orderId }) => ({ row: item, orderId, itemId: item?.id || null })),
    ...(orders || []).map((row) => ({ row, orderId: row.id, itemId: null })),
  ];
  const fieldPresent = rows.some(({ row }) => row && ("delayed" in row || "delayMinutes" in row || "delayedAt" in row));
  const found = new Map();
  const remember = (entry) => {
    const key = `${entry.orderId || ""}:${entry.itemId || ""}:${entry.basis}`;
    if (!found.has(key)) found.set(key, entry);
  };

  rows.forEach(({ row, orderId, itemId }) => {
    if (!row) return;
    const flagged = row.delayed === true || finite(row.delayMinutes) > 0 || Boolean(row.delayedAt);
    if (flagged) remember(delayEntry(orderId, itemId, finite(row.delayMinutes), "recorded"));
  });

  if (threshold == null) {
    if (!fieldPresent && found.size === 0) {
      return { status: "missing", value: null, count: null, orders: [], reason: "delay_not_recorded" };
    }
    const ordersOut = [...found.values()];
    return { status: "available", value: ordersOut.length, count: ordersOut.length, orders: ordersOut, reason: null };
  }

  if (!Number.isFinite(threshold) || threshold < 0) {
    return { status: "missing", value: null, count: null, orders: [], reason: "delay_threshold_invalid" };
  }

  let untimed = 0;
  (items || []).forEach(({ item, orderId }) => {
    const start = stamp(item, ["orderedAt", "preparingAt", "startedAt"]);
    const end = stamp(item, ["servedAt", "readyAt"]);
    const elapsed = end ? minutesBetween(start, end) : (now ? minutesBetween(start, now) : null);
    if (elapsed == null) {
      untimed += 1;
      return;
    }
    if (elapsed > threshold) remember(delayEntry(orderId, item?.id, elapsed, "threshold"));
  });

  const ordersOut = [...found.values()];
  if (untimed > 0) {
    return {
      status: "partial",
      value: ordersOut.length,
      count: ordersOut.length,
      orders: ordersOut,
      untimed,
      reason: "delay_times_incomplete",
    };
  }
  return { status: "available", value: ordersOut.length, count: ordersOut.length, orders: ordersOut, untimed, reason: null };
}

function spendPerGuest(visits, reservationsById, sessionsById, billsBySession) {
  if (visits == null) return { status: "missing", average: null, spend: null, guests: null, visits: null, reason: "visits_not_recorded", verifiedComparable: false };
  if (!visits.length) {
    return { status: "missing", average: null, spend: null, guests: null, visits: 0, reason: "no_completed_visits", verifiedComparable: false };
  }
  let spend = 0;
  let guests = 0;
  let missingSpend = 0;
  let missingCovers = 0;
  visits.forEach((visit) => {
    const amount = finite(visit.total) ?? finite(billsBySession.get(visit.sessionId)?.total);
    const covers = coversOf(visit, reservationsById, sessionsById);
    if (amount == null) missingSpend += 1;
    else spend += amount;
    if (covers == null) missingCovers += 1;
    else guests += covers;
  });
  if (missingSpend > 0) {
    return { status: "missing", average: null, spend: null, guests: null, visits: visits.length, reason: "spend_not_recorded", verifiedComparable: false };
  }
  if (missingCovers > 0 || guests == null) {
    return { status: "missing", average: null, spend, guests: null, visits: visits.length, reason: "covers_not_recorded_for_every_visit", verifiedComparable: false };
  }
  if (guests === 0) {
    return { status: "missing", average: null, spend, guests: 0, visits: visits.length, reason: "zero_covers", verifiedComparable: false };
  }
  return {
    status: "available",
    average: spend / guests,
    spend,
    guests,
    visits: visits.length,
    reason: null,
    verifiedComparable: false,
  };
}

export function serviceMetric(summary, key) {
  if (!summary?.ok) return leaf(null, "snapshot_missing");
  const metrics = {
    reservations: summary.reservations.total,
    cancelledReservations: summary.reservations.cancelled,
    coversServed: summary.covers.served,
    walkIns: summary.covers.walkIns,
    occupiedTables: summary.occupancy.occupied,
    completedTurns: summary.occupancy.turnover.completedTurns,
    averageTurnsPerTable: summary.occupancy.turnover.averageTurnsPerTable,
    averageTurnoverMinutes: summary.occupancy.turnover.averageMinutes?.status === "available"
      ? summary.occupancy.turnover.averageMinutes
      : leaf(null, summary.occupancy.turnover.averageMinutes?.reason || "session_times_not_recorded"),
    averageSessionMinutes: summary.sessionDuration.status === "available"
      ? leaf(summary.sessionDuration.average, null)
      : leaf(null, summary.sessionDuration.reason),
    orderCount: summary.orders.count,
    orderValue: summary.orders.value,
    averagePrepMinutes: summary.kitchen.status === "available"
      ? leaf(summary.kitchen.average, null)
      : leaf(null, summary.kitchen.reason),
    delayedOrders: summary.readiness.delayed.status === "available"
      ? leaf(summary.readiness.delayed.count, null)
      : leaf(null, summary.readiness.delayed.reason),
    paidBills: summary.bills.paid,
    billValue: summary.bills.paidValue,
    simulatedPayments: summary.payments.simulated,
    simulatedPaymentAmount: summary.payments.simulatedAmount,
    realPayments: summary.payments.real,
    realPaymentAmount: summary.payments.realAmount,
    spendPerGuest: summary.spendPerGuest.status === "available"
      ? leaf(summary.spendPerGuest.average, null)
      : leaf(null, summary.spendPerGuest.reason),
    completedVisits: summary.visits.completed,
  };
  const metric = metrics[key];
  if (!metric) return leaf(null, "metric_unknown");
  if (metric.status !== "available") return leaf(null, metric.reason || "not_recorded");
  return metric;
}

export function adaptServiceSummary(state, options = {}) {
  if (!state || typeof state !== "object") {
    return { ok: false, reason: "snapshot_missing", writes: SERVICE_ANALYTICS_WRITES, readOnly: true };
  }
  const branch = assertServiceBranch(state.branchId);
  if (!branch.ok) {
    return { ok: false, reason: branch.reason, branchId: state.branchId || null, writes: SERVICE_ANALYTICS_WRITES, readOnly: true };
  }

  const declaredName = String(options.dataOrigin || state.dataOrigin || "").toLowerCase();
  const declared = declaredName === VERIFIED_OPERATIONAL || declaredName === "verified"
    ? VERIFIED_OPERATIONAL
    : SIMULATED_SERVICE;
  const partitioned = {
    tables: sameBranch(listOrMissing(state.tables), state.branchId),
    reservations: sameBranch(listOrMissing(state.reservations), state.branchId),
    sessions: sameBranch(listOrMissing(state.sessions), state.branchId),
    orders: sameBranch(listOrMissing(state.orders), state.branchId),
    tickets: sameBranch(listOrMissing(state.tickets), state.branchId),
    bills: sameBranch(listOrMissing(state.bills), state.branchId),
    payments: sameBranch(listOrMissing(state.payments), state.branchId),
    visits: sameBranch(listOrMissing(state.visits), state.branchId),
  };
  const excludedForeignRows = Object.values(partitioned).reduce((sum, group) => sum + group.excluded, 0);
  const tables = partitioned.tables.rows;
  const reservations = partitioned.reservations.rows;
  const sessions = partitioned.sessions.rows;
  const orders = partitioned.orders.rows;
  const tickets = partitioned.tickets.rows;
  const bills = partitioned.bills.rows;
  const payments = partitioned.payments.rows;
  const visits = partitioned.visits.rows;

  const marked = [reservations, sessions, orders, tickets, bills, payments, visits]
    .flatMap((rows) => rows || [])
    .map((row) => explicitOrigin(row))
    .filter(Boolean);
  const marks = new Set(marked);
  const hasSimulatedMark = marks.has(SIMULATED_SERVICE);
  const hasVerifiedMark = marks.has(VERIFIED_OPERATIONAL);
  let dataOrigin = declared === VERIFIED_OPERATIONAL ? VERIFIED_OPERATIONAL : SIMULATED_SERVICE;
  if ((hasSimulatedMark && hasVerifiedMark)
    || (hasSimulatedMark && declared === VERIFIED_OPERATIONAL)
    || (hasVerifiedMark && declared === SIMULATED_SERVICE)) {
    dataOrigin = MIXED_ORIGIN;
  }
  if (state.developmentDatabase === true) dataOrigin = "local_development_database";

  const reservationsById = indexById(reservations || []);
  const sessionsById = indexById(sessions || []);
  const billsBySession = new Map();
  (bills || []).forEach((bill) => {
    if (bill?.sessionId) billsBySession.set(bill.sessionId, bill);
  });

  const reservationCounts = { booked: 0, seated: 0, cancelled: 0, noShow: 0, other: 0 };
  (reservations || []).forEach((row) => {
    reservationCounts[reservationBucket(row)] += 1;
  });

  const occupiedTables = (tables || []).filter((table) => table.status === "occupied" || table.sessionId).map((table) => ({
    id: table.id,
    label: table.label || table.id,
    sessionId: table.sessionId || null,
    seats: finite(table.seats),
  }));

  const closedSessions = (sessions || []).filter((session) => session.status === "closed" || stamp(session, ["closedAt", "endedAt"]));
  const sessionSamples = [];
  let untimedSessions = 0;
  closedSessions.forEach((session) => {
    const minutes = minutesBetween(
      stamp(session, ["openedAt", "startedAt"]),
      stamp(session, ["closedAt", "endedAt"]),
    );
    if (minutes == null) untimedSessions += 1;
    else sessionSamples.push(minutes);
  });

  const items = itemList(orders);
  const prepSamples = [];
  let untimedItems = 0;
  (items || []).forEach(({ item }) => {
    const minutes = minutesBetween(
      stamp(item, ["preparingAt", "orderedAt", "startedAt"]),
      stamp(item, ["readyAt"]),
    );
    if (minutes == null) untimedItems += 1;
    else prepSamples.push(minutes);
  });
  (tickets || []).forEach((ticket) => {
    if ((items || []).length) return;
    const minutes = minutesBetween(stamp(ticket, ["preparingAt", "startedAt"]), stamp(ticket, ["readyAt"]));
    if (minutes == null) untimedItems += 1;
    else prepSamples.push(minutes);
  });

  const readiness = { ordered: 0, preparing: 0, ready: 0, served: 0, other: 0 };
  (items || []).forEach(({ item }) => {
    const status = String(item?.status || "");
    if (status in readiness) readiness[status] += 1;
    else readiness.other += 1;
  });

  const orderValue = orders == null
    ? leaf(null, "orders_not_recorded")
    : sumMoney(items || [], ({ item }) => item?.price);

  const openBills = (bills || []).filter((bill) => bill.status === "open");
  const paidBills = (bills || []).filter((bill) => bill.status === "paid");
  const seatedSessions = (sessions || []).filter((session) => session.status === "open");
  const seatedCoverRows = seatedSessions.map((session) => ({
    covers: finite(session.covers),
    partySize: finite(session.partySize),
    reservationId: session.reservationId,
    sessionId: session.id,
  }));

  const walkIns = countWalkIns(reservations);
  const walkInCoverRows = (reservations || []).filter((row) => walkInClass(row) === "yes");
  const served = sumCovers(visits, reservationsById, sessionsById);
  const seated = sumCovers(
    sessions == null ? null : seatedCoverRows.map((session) => ({
      covers: session.covers,
      partySize: session.partySize ?? reservationsById.get(session.reservationId)?.partySize,
      reservationId: session.reservationId,
      sessionId: session.sessionId,
    })),
    reservationsById,
    sessionsById,
  );

  const completedTurns = visits == null ? leaf(null, "visits_not_recorded") : leaf(visits.length, null);
  const averageTurnsPerTable = tables == null
    ? leaf(null, "tables_not_recorded")
    : tables.length === 0
      ? leaf(null, "no_tables")
      : completedTurns.status !== "available" || completedTurns.value === 0
        ? leaf(null, "no_completed_turns")
        : leaf(completedTurns.value / tables.length, null);

  const turnoverMinutes = closedSessions.length
    ? durationReport(sessionSamples, untimedSessions, "session_times_not_recorded")
    : { ...leaf(null, visits?.length ? "session_times_not_recorded" : "no_closed_sessions"), average: null, median: null, count: 0, untimed: 0 };

  const spend = spendPerGuest(visits, reservationsById, sessionsById, billsBySession);
  spend.verifiedComparable = dataOrigin === VERIFIED_OPERATIONAL && spend.status === "available";

  const base = sessions && bills && visits
    ? serviceSummary({ branchId: state.branchId, sessions, bills, visits })
    : null;

  const simulatedRecords = dataOrigin === SIMULATED_SERVICE
    ? [reservations, sessions, orders, tickets, bills, payments, visits].reduce((sum, rows) => sum + (rows ? rows.length : 0), 0)
    : marked.filter((origin) => origin === SIMULATED_SERVICE).length;
  const verifiedRecords = dataOrigin === VERIFIED_OPERATIONAL
    ? [reservations, sessions, orders, tickets, bills, payments, visits].reduce((sum, rows) => sum + (rows ? rows.length : 0), 0)
    : marked.filter((origin) => origin === VERIFIED_OPERATIONAL).length;

  return {
    ok: true,
    writes: SERVICE_ANALYTICS_WRITES,
    readOnly: true,
    branchId: state.branchId,
    dataOrigin,
    asOf: typeof state.asOf === "string" ? state.asOf : (typeof options.now === "string" ? options.now : null),
    freshness: typeof state.asOf === "string" ? "recorded" : "not_recorded",
    excludedForeignRows,
    evidenceDates: collectDates([reservations, sessions, orders, tickets, bills, payments, visits]),
    base,
    simulatedRecords,
    verifiedRecords,
    reservations: reservations == null
      ? { status: "missing", total: leaf(null, "reservations_not_recorded"), booked: leaf(null, "reservations_not_recorded"), seated: leaf(null, "reservations_not_recorded"), cancelled: leaf(null, "reservations_not_recorded"), noShow: leaf(null, "reservations_not_recorded"), reason: "reservations_not_recorded" }
      : {
        status: "available",
        total: leaf(reservations.length, null),
        booked: leaf(reservationCounts.booked, null),
        seated: leaf(reservationCounts.seated, null),
        cancelled: leaf(reservationCounts.cancelled, null),
        noShow: leaf(reservationCounts.noShow, null),
        reason: null,
      },
    covers: {
      served,
      seated,
      walkIns,
      walkInCovers: walkIns.status !== "available"
        ? leaf(null, walkIns.reason)
        : walkIns.value === 0
          ? leaf(0, null)
          : sumCovers(walkInCoverRows.map((row) => ({ covers: finite(row.partySize), reservationId: row.id })), reservationsById, sessionsById),
    },
    occupancy: {
      status: tables == null ? "missing" : "available",
      occupied: tables == null ? leaf(null, "tables_not_recorded") : leaf(occupiedTables.length, null),
      open: tables == null ? leaf(null, "tables_not_recorded") : leaf(tables.filter((table) => table.status === "open" && !table.sessionId).length, null),
      assigned: tables == null ? leaf(null, "tables_not_recorded") : leaf(tables.filter((table) => table.status === "assigned").length, null),
      total: tables == null ? leaf(null, "tables_not_recorded") : leaf(tables.length, null),
      occupiedTables: tables == null ? [] : occupiedTables,
      turnover: {
        completedTurns,
        averageTurnsPerTable,
        averageMinutes: turnoverMinutes.average == null
          ? leaf(null, turnoverMinutes.reason || "session_times_not_recorded")
          : { status: turnoverMinutes.status, value: turnoverMinutes.average, reason: turnoverMinutes.reason, median: turnoverMinutes.median, count: turnoverMinutes.count, untimed: turnoverMinutes.untimed },
      },
      reason: tables == null ? "tables_not_recorded" : null,
    },
    sessionDuration: closedSessions.length
      ? {
        status: untimedSessions > 0 && sessionSamples.length ? "partial" : (sessionSamples.length ? "available" : "missing"),
        average: sessionSamples.length ? sessionSamples.reduce((sum, n) => sum + n, 0) / sessionSamples.length : null,
        median: durationReport(sessionSamples, untimedSessions, "session_times_not_recorded").median,
        count: sessionSamples.length,
        untimed: untimedSessions,
        openSessions: seatedSessions.length,
        reason: sessionSamples.length ? (untimedSessions ? "untimed_records_excluded" : null) : "session_times_not_recorded",
      }
      : { status: "missing", average: null, median: null, count: 0, untimed: 0, openSessions: seatedSessions.length, reason: "no_closed_sessions" },
    orders: {
      status: orders == null ? "missing" : "available",
      count: orders == null ? leaf(null, "orders_not_recorded") : leaf(orders.length, null),
      value: orders == null ? leaf(null, "orders_not_recorded") : (items || []).length === 0 ? leaf(0, null) : orderValue,
      currency: "SAR",
      reason: orders == null ? "orders_not_recorded" : orderValue.reason,
    },
    kitchen: items == null && tickets == null
      ? { status: "missing", average: null, median: null, count: 0, untimed: 0, reason: "kitchen_not_recorded" }
      : (() => {
        const noKitchenRows = (items || []).length === 0 && (tickets || []).length === 0;
        const report = durationReport(
          prepSamples,
          untimedItems,
          noKitchenRows ? "no_items" : "preparation_times_not_recorded",
        );
        return {
          status: report.status,
          average: report.average,
          median: report.median,
          count: report.count,
          untimed: report.untimed,
          reason: report.reason,
        };
      })(),
    readiness: {
      status: items == null ? "missing" : "available",
      ordered: items == null ? leaf(null, "items_not_recorded") : leaf(readiness.ordered, null),
      preparing: items == null ? leaf(null, "items_not_recorded") : leaf(readiness.preparing, null),
      ready: items == null ? leaf(null, "items_not_recorded") : leaf(readiness.ready, null),
      served: items == null ? leaf(null, "items_not_recorded") : leaf(readiness.served, null),
      delayed: collectDelays({
        orders,
        tickets,
        items,
        threshold: options.delayThresholdMinutes,
        now: options.now || null,
      }),
      reason: items == null ? "items_not_recorded" : null,
    },
    bills: bills == null
      ? { status: "missing", open: leaf(null, "bills_not_recorded"), paid: leaf(null, "bills_not_recorded"), openValue: leaf(null, "bills_not_recorded"), paidValue: leaf(null, "bills_not_recorded"), reason: "bills_not_recorded" }
      : {
        status: "available",
        open: leaf(openBills.length, null),
        paid: leaf(paidBills.length, null),
        openValue: sumMoney(openBills, (bill) => bill.total),
        paidValue: sumMoney(paidBills, (bill) => bill.total),
        reason: null,
      },
    payments: paymentTotals(payments, dataOrigin),
    spendPerGuest: spend,
    visits: visits == null
      ? { status: "missing", completed: leaf(null, "visits_not_recorded"), reason: "visits_not_recorded" }
      : { status: "available", completed: leaf(visits.length, null), reason: null },
  };
}
