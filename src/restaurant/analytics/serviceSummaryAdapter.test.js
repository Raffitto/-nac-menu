import { createRestaurant } from "../model";
import { serviceSummary } from "../contracts";
import {
  adaptServiceSummary,
  serviceMetric,
  summarizeDurations,
  SIMULATED_SERVICE,
  VERIFIED_OPERATIONAL,
  MIXED_ORIGIN,
} from "./serviceSummaryAdapter";

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function closeKhobar() {
  const restaurant = createRestaurant({ branchId: "khobar" });
  const booked = restaurant.reserve({ guestName: "Layla", partySize: 2 });
  restaurant.assignTable(booked.reservation.id, "khobar:12");
  const opened = restaurant.openSession("khobar:12");
  restaurant.addItem(opened.session.id, { itemId: "toast", modifierIds: ["honey"] });
  restaurant.setKitchenStatus(opened.order.id, "preparing");
  restaurant.setKitchenStatus(opened.order.id, "ready");
  restaurant.markServed(opened.order.id);
  const bill = restaurant.openBill(opened.session.id);
  restaurant.pay(opened.session.id, { amount: 30 });
  restaurant.pay(opened.session.id, { amount: bill.bill.total - 30 });
  restaurant.closeTable(opened.session.id);
  return restaurant;
}

function verifiedDay({ covers = 2, spend = 60, cancelled = 0, date = "2026-10-15" } = {}) {
  const reservations = [
    { id: "r1", branchId: "khobar", partySize: covers, status: "seated", channel: "reservation", businessDate: date, origin: "verified_operational" },
  ];
  for (let i = 0; i < cancelled; i += 1) {
    reservations.push({
      id: `c${i}`,
      branchId: "khobar",
      partySize: 2,
      status: "cancelled",
      channel: "reservation",
      businessDate: date,
      origin: "verified_operational",
    });
  }
  return {
    branchId: "khobar",
    dataOrigin: "verified_operational",
    asOf: `${date}T23:00:00+03:00`,
    tables: [{ id: "t1", branchId: "khobar", label: "12", seats: 4, status: "open", sessionId: null }],
    reservations,
    sessions: [{
      id: "s1",
      branchId: "khobar",
      reservationId: "r1",
      status: "closed",
      openedAt: `${date}T19:00:00+03:00`,
      closedAt: `${date}T20:30:00+03:00`,
      origin: "verified_operational",
    }],
    orders: [{
      id: "o1",
      branchId: "khobar",
      sessionId: "s1",
      status: "closed",
      origin: "verified_operational",
      items: [
        {
          id: "i1",
          price: 40,
          status: "served",
          preparingAt: `${date}T19:06:00+03:00`,
          readyAt: `${date}T19:20:00+03:00`,
          origin: "verified_operational",
        },
        {
          id: "i2",
          price: 20,
          status: "served",
          orderedAt: `${date}T19:05:00+03:00`,
          readyAt: `${date}T19:25:00+03:00`,
          delayed: true,
          delayMinutes: 8,
          origin: "verified_operational",
        },
      ],
    }],
    tickets: [{ id: "ticket:o1", orderId: "o1", branchId: "khobar", status: "served", origin: "verified_operational" }],
    bills: [{ id: "bill:s1", sessionId: "s1", branchId: "khobar", total: spend, status: "paid", origin: "verified_operational" }],
    payments: [{ id: "p1", billId: "bill:s1", sessionId: "s1", branchId: "khobar", amount: spend, method: "card", status: "captured", origin: "verified_operational" }],
    visits: [{ id: "v1", branchId: "khobar", sessionId: "s1", reservationId: "r1", total: spend, covers, businessDate: date, origin: "verified_operational" }],
  };
}

describe("serviceSummary adapter", () => {
  test("calculates a closed simulated visit without treating the audit sequence as time", () => {
    const restaurant = closeKhobar();
    const summary = adaptServiceSummary(restaurant.state);
    expect(summary.writes).toBe(0);
    expect(summary.readOnly).toBe(true);
    expect(summary.dataOrigin).toBe(SIMULATED_SERVICE);
    expect(summary.base).toEqual(serviceSummary(restaurant.state));
    expect(summary.reservations.total.value).toBe(1);
    expect(summary.reservations.cancelled.value).toBe(0);
    expect(summary.covers.served.value).toBe(2);
    expect(summary.covers.walkIns).toMatchObject({ status: "missing", value: null, reason: "walk_in_not_recorded" });
    expect(summary.occupancy.occupied.value).toBe(0);
    expect(summary.occupancy.turnover.completedTurns.value).toBe(1);
    expect(summary.occupancy.turnover.averageTurnsPerTable.value).toBeCloseTo(1 / 47);
    expect(summary.occupancy.turnover.averageMinutes.value).toBeNull();
    expect(summary.sessionDuration.average).toBeNull();
    expect(summary.orders.count.value).toBe(1);
    expect(summary.orders.value.value).toBe(63);
    expect(summary.kitchen.average).toBeNull();
    expect(summary.kitchen.reason).toBe("preparation_times_not_recorded");
    expect(summary.readiness.served.value).toBe(1);
    expect(summary.readiness.delayed).toMatchObject({ status: "missing", value: null, reason: "delay_not_recorded" });
    expect(summary.bills.paid.value).toBe(1);
    expect(summary.payments.simulated.value).toBe(2);
    expect(summary.payments.simulatedAmount.value).toBe(63);
    expect(summary.payments.real.value).toBe(0);
    expect(summary.spendPerGuest).toMatchObject({ status: "available", average: 31.5, guests: 2, spend: 63 });
    expect(summary.visits.completed.value).toBe(1);
    expect(summary.verifiedRecords).toBe(0);
    expect(serviceMetric(summary, "averagePrepMinutes").value).toBeNull();
    expect(serviceMetric(summary, "spendPerGuest").value).toBe(31.5);
  });

  test("names the occupied simulated table and does not mutate the store", () => {
    const restaurant = createRestaurant({ branchId: "riyadh" });
    const booked = restaurant.reserve({ guestName: "Nora", partySize: 3 });
    restaurant.assignTable(booked.reservation.id, "t1");
    restaurant.openSession("t1");
    const before = JSON.stringify(restaurant.state);
    const auditLength = restaurant.state.audit.length;
    freeze(restaurant.state);
    const summary = adaptServiceSummary(restaurant.state);
    expect(summary.occupancy.occupiedTables).toEqual([
      expect.objectContaining({ id: "t1", label: "12", seats: null }),
    ]);
    expect(summary.covers.seated.value).toBe(3);
    expect(summary.occupancy.occupied.value).toBe(1);
    expect(restaurant.state.audit).toHaveLength(auditLength);
    expect(JSON.stringify(restaurant.state)).toBe(before);
  });

  test("keeps an empty visit list from becoming an average spend of zero", () => {
    const summary = adaptServiceSummary({
      branchId: "jeddah",
      tables: [{ id: "t1", branchId: "jeddah", label: "4", seats: 2, status: "open" }],
      reservations: [],
      sessions: [],
      orders: [],
      tickets: [],
      bills: [],
      payments: [],
      visits: [],
    });
    expect(summary.visits.completed.value).toBe(0);
    expect(summary.reservations.cancelled.value).toBe(0);
    expect(summary.spendPerGuest).toMatchObject({ status: "missing", average: null, reason: "no_completed_visits" });
    expect(summary.occupancy.turnover.averageTurnsPerTable.value).toBeNull();
    expect(summary.orders.value.value).toBe(0);
  });

  test("does not coerce absent collections into zero", () => {
    const summary = adaptServiceSummary({ branchId: "khobar" });
    expect(summary.reservations.cancelled).toMatchObject({ status: "missing", value: null });
    expect(summary.covers.served).toMatchObject({ status: "missing", value: null });
    expect(summary.covers.walkIns).toMatchObject({ status: "missing", value: null });
    expect(summary.visits.completed).toMatchObject({ status: "missing", value: null });
    expect(summary.payments.real).toMatchObject({ status: "missing", value: null });
    expect(summary.base).toBeNull();
  });

  test("identifies verified operations, real payments, prep time, and a recorded delay", () => {
    const summary = adaptServiceSummary(verifiedDay({ cancelled: 1 }));
    expect(summary.dataOrigin).toBe(VERIFIED_OPERATIONAL);
    expect(summary.freshness).toBe("recorded");
    expect(summary.payments.real.value).toBe(1);
    expect(summary.payments.simulated.value).toBe(0);
    expect(summary.payments.realAmount.value).toBe(60);
    expect(summary.reservations.cancelled.value).toBe(1);
    expect(summary.kitchen).toMatchObject({ status: "available", average: 17, median: 17, count: 2 });
    expect(summary.sessionDuration).toMatchObject({ status: "available", average: 90 });
    expect(summary.occupancy.turnover.averageMinutes.value).toBe(90);
    expect(summary.readiness.delayed.status).toBe("available");
    expect(summary.readiness.delayed.count).toBe(1);
    expect(summary.readiness.delayed.orders[0]).toMatchObject({ orderId: "o1", itemId: "i2", basis: "recorded" });
    expect(summary.spendPerGuest.verifiedComparable).toBe(true);
    expect(summarizeDurations([14, 20])).toMatchObject({ average: 17, median: 17 });
  });

  test("a simulated payment inside a verified claim is mixed and is not a real settlement", () => {
    const state = verifiedDay();
    state.payments.push({
      id: "p2",
      billId: "bill:s1",
      sessionId: "s1",
      branchId: "khobar",
      amount: 5,
      method: "simulated",
      status: "simulated",
    });
    const summary = adaptServiceSummary(state, { dataOrigin: "verified_operational" });
    expect(summary.dataOrigin).toBe(MIXED_ORIGIN);
    expect(summary.payments.simulated.value).toBe(1);
    expect(summary.payments.real.value).toBe(1);
    expect(summary.spendPerGuest.verifiedComparable).toBe(false);
  });

  test("counts walk-ins only when the arrival field is present", () => {
    const state = verifiedDay();
    state.reservations.push({
      id: "w1",
      branchId: "khobar",
      partySize: 1,
      status: "seated",
      channel: "walk-in",
      businessDate: "2026-10-15",
      origin: "verified_operational",
    });
    const summary = adaptServiceSummary(state);
    expect(summary.covers.walkIns.value).toBe(1);
    expect(summary.covers.walkInCovers.value).toBe(1);
    const unmarked = adaptServiceSummary({
      ...state,
      reservations: state.reservations.map(({ channel, ...row }) => row),
    });
    expect(unmarked.covers.walkIns).toMatchObject({ status: "missing", value: null, reason: "walk_in_not_recorded" });
  });

  test("leaves order value missing when an item has no price", () => {
    const state = verifiedDay();
    state.orders[0].items.push({ id: "i3", status: "served", origin: "verified_operational" });
    const summary = adaptServiceSummary(state);
    expect(summary.orders.count.value).toBe(1);
    expect(summary.orders.value).toMatchObject({ status: "missing", value: null, reason: "amount_not_recorded" });
    expect(summary.kitchen).toMatchObject({ status: "partial", average: 17, untimed: 1 });
  });

  test("uses a supplied delay threshold and does not invent one", () => {
    const state = verifiedDay();
    state.orders[0].items = [{
      id: "i1",
      price: 40,
      status: "served",
      orderedAt: "2026-10-15T19:00:00+03:00",
      readyAt: "2026-10-15T19:20:00+03:00",
      origin: "verified_operational",
    }];
    expect(adaptServiceSummary(state).readiness.delayed.reason).toBe("delay_not_recorded");
    const flagged = adaptServiceSummary(state, { delayThresholdMinutes: 15 });
    expect(flagged.readiness.delayed.status).toBe("available");
    expect(flagged.readiness.delayed.count).toBe(1);
    expect(flagged.readiness.delayed.orders[0].delayMinutes).toBe(20);
    expect(adaptServiceSummary(state, { delayThresholdMinutes: 30 }).readiness.delayed.count).toBe(0);
  });

  test("drops another branch's rows from the summary", () => {
    const state = verifiedDay();
    state.visits.push({ id: "foreign", branchId: "riyadh", total: 500, covers: 20, businessDate: "2026-10-15" });
    const summary = adaptServiceSummary(state);
    expect(summary.visits.completed.value).toBe(1);
    expect(summary.covers.served.value).toBe(2);
    expect(summary.excludedForeignRows).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("500");
  });

  test("refuses Hettin and an empty snapshot", () => {
    expect(adaptServiceSummary({ branchId: "hettin", visits: [] }).reason).toBe("hettin_guest_hidden");
    expect(adaptServiceSummary(null).reason).toBe("snapshot_missing");
    expect(adaptServiceSummary({ branchId: "dammam" }).reason).toBe("branch_not_in_service");
  });

  test("does not turn a missing party size into spend per guest", () => {
    const state = verifiedDay();
    delete state.visits[0].covers;
    state.reservations[0].partySize = null;
    const summary = adaptServiceSummary(state);
    expect(summary.covers.served.value).toBeNull();
    expect(summary.spendPerGuest.average).toBeNull();
    expect(summary.spendPerGuest.reason).toBe("covers_not_recorded_for_every_visit");
  });
});
