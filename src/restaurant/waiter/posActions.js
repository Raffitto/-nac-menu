/**
 * Waiter terminal actions. Mutations go through performServiceAction
 * with the current revision. This module does not open a second store.
 */
import { performServiceAction } from "../contracts";
import { planDiscount } from "../platformContract";

export const CLOCK_KEY = "nac-waiter-pos-clock:v1";
export const COURSE_KEY = "nac-waiter-pos-course:v1";

export const COURSES = Object.freeze(["Table", "Starter", "Main", "Dessert"]);

export const MISSING_CONTRACT_ACTIONS = Object.freeze([
  { id: "print", note: "No print action. This terminal does not print." },
  { id: "voidItem", note: "A future waiter action. Sent items cannot be voided." },
  { id: "correctItem", note: "A future waiter action. Sent quantity and add-ons stay as sent." },
  { id: "discount", note: "Discount planning does not post, and the waiter role is not permitted." },
  { id: "tags", note: "No tag action on the service." },
  { id: "course", note: "Order lines have no course field. Course labels stay on this terminal." },
  { id: "sessionOpenedAt", note: "Sessions have no opened-at time. Elapsed time is a terminal clock." },
  { id: "tax", note: "The check total has no tax line." },
  { id: "guestRename", note: "A seated guest name cannot be edited." },
  { id: "routeItem", note: "A future kitchen action. Bar tickets cannot be posted, so drinks stay on the check." },
]);

const NOTICE = Object.freeze({
  party_size_invalid: "Enter the number of guests.",
  guest_name_required: "Enter a guest name.",
  table_inactive: "This table is not in service.",
  table_not_assigned: "Seat the table before opening the order.",
  session_already_open: "This table already has an order.",
  table_unavailable: "This table is not free.",
  item_not_available: "That product is not on this menu.",
  item_unavailable: "That product is unavailable.",
  modifier_not_available: "That add-on is not on this product.",
  preparation_required: "Choose the preparation before adding this item.",
  preparation_not_available: "That preparation is not on this product.",
  modifier_duplicate: "That add-on is already selected.",
  item_not_in_menu: "That product is not on the published menu.",
  sign_in_failed: "Sign-in failed.",
  sign_in_required: "Sign in again.",
  service_unavailable: "The restaurant service did not respond. Nothing was sent.",
  rate_limited: "Too many sign-in attempts. Wait a minute.",
  nothing_to_send: "Nothing new to send.",
  bar_route_not_posted: "These drinks stay on the check. A bar ticket cannot be posted yet.",
  station_not_recorded: "Station is not recorded for these items, so they stayed on the check.",
  ticket_not_ready: "The kitchen has not marked this ready.",
  ticket_closed: "This ticket is already served.",
  service_conflict: "This table changed. Try that again.",
  role_forbidden: "That action is not available on this terminal.",
  quantity_invalid: "Enter a quantity from 1 to 99.",
});

export function noticeFor(reason) {
  return NOTICE[reason] || "That action is not available.";
}

export function callService(restaurant, role, action, payload) {
  const revision = restaurant.state.revision;
  const args = Array.isArray(payload) ? [...payload, revision] : [payload, revision];
  return performServiceAction(restaurant, role, action, args);
}

export function serviceClock(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function serviceDay(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function posMoney(value) {
  if (!Number.isFinite(value)) return "Amount unavailable";
  return `${value.toFixed(2)} SAR`;
}

export function seatCaption(table) {
  if (table?.capacity === "verified" && Number.isInteger(table.maxSeats)) {
    if (Number.isInteger(table.minSeats) && table.minSeats !== table.maxSeats) {
      return `${table.minSeats}–${table.maxSeats} seats`;
    }
    return `${table.maxSeats} seats`;
  }
  return "Seats unverified";
}

export function elapsedLabel(startedAt, now) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return null;
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60000);
  if (minutes < 1) return "Just seated";
  if (minutes === 1) return "1 min";
  return `${minutes} min`;
}

export function readMap(storage, key) {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberSeating(storage, sessionId, at) {
  if (!storage || !sessionId || !Number.isFinite(at)) return;
  const map = readMap(storage, CLOCK_KEY);
  if (map[sessionId] != null) return;
  map[sessionId] = at;
  storage.setItem(CLOCK_KEY, JSON.stringify(map));
}

export function rememberCourses(storage, pairs) {
  if (!storage) return;
  const map = readMap(storage, COURSE_KEY);
  (pairs || []).forEach(({ id, course }) => {
    if (id && course) map[id] = course;
  });
  storage.setItem(COURSE_KEY, JSON.stringify(map));
}

export function groupCatalogue(lines) {
  const categories = new Map();
  (lines || []).filter((line) => line.available !== false).forEach((line) => {
    const categoryId = line.categoryId || "menu";
    if (!categories.has(categoryId)) {
      categories.set(categoryId, {
        id: categoryId,
        name: line.categoryName || "Menu",
        sort: Number.isFinite(line.categorySort) ? line.categorySort : 99,
        sections: new Map(),
      });
    }
    const category = categories.get(categoryId);
    const sectionId = line.sectionId || `${categoryId}:items`;
    if (!category.sections.has(sectionId)) {
      category.sections.set(sectionId, {
        id: sectionId,
        name: line.sectionName || "Menu",
        sort: Number.isFinite(line.sectionSort) ? line.sectionSort : 99,
        image: line.image || null,
        items: [],
      });
    }
    const section = category.sections.get(sectionId);
    if (!section.image && line.image) section.image = line.image;
    section.items.push(line);
  });
  return [...categories.values()]
    .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name))
    .map((category) => ({
      ...category,
      sections: [...category.sections.values()].sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name)),
    }));
}

function band(value, size) {
  const number = Number.isFinite(value) ? value : 50;
  return Math.round(number / size) * size;
}

export function placeTables(tables) {
  const source = tables || [];
  if (!source.length) return [];
  const rows = new Map();
  source.forEach((table) => {
    const key = band(table.y, 12);
    const list = rows.get(key) || [];
    list.push(table);
    rows.set(key, list);
  });
  const visualRows = [];
  [...rows.keys()].sort((left, right) => left - right).forEach((key) => {
    const list = rows.get(key).slice().sort((left, right) => (
      (Number.isFinite(left.x) ? left.x : 0) - (Number.isFinite(right.x) ? right.x : 0)
      || String(left.label).localeCompare(String(right.label), undefined, { numeric: true })
    ));
    for (let index = 0; index < list.length; index += 5) visualRows.push(list.slice(index, index + 5));
  });
  const placed = [];
  visualRows.forEach((list, rowIndex) => {
    list.forEach((table, column) => {
      placed.push({
        table,
        left: ((column + 1) / (list.length + 1)) * 100,
        top: ((rowIndex + 0.5) / visualRows.length) * 100,
      });
    });
  });
  return placed;
}

function existingOrder(state, tableId) {
  const session = state.sessions.find((row) => row.tableId === tableId && row.status === "open") || null;
  if (!session) return null;
  const order = state.orders.find((row) => row.sessionId === session.id) || null;
  const ticket = state.tickets.find((row) => row.orderId === order?.id && (row.station || "pass") === "pass") || null;
  return { session, order, ticket };
}

export function openTableOrder(restaurant, { tableId, partySize, guestName, now = new Date() } = {}) {
  const table = restaurant.state.tables.find((row) => row.id === tableId);
  if (!table || table.active === false || table.removed) {
    return { ok: false, reason: "table_inactive", writes: 0 };
  }
  const open = existingOrder(restaurant.state, tableId);
  if (open) return { ok: true, ...open, created: false, revision: restaurant.state.revision, writes: 0 };

  const seated = restaurant.state.reservations.find((row) => row.tableId === tableId && row.status === "seated");
  if (!seated) {
    const covers = Number(partySize);
    if (!Number.isInteger(covers) || covers < 1 || covers > 20) {
      return { ok: false, reason: "party_size_invalid", writes: 0 };
    }
    const name = String(guestName || "Walk-in").trim().slice(0, 80) || "Walk-in";
    const reserved = callService(restaurant, "host", "reserve", {
      guestName: name,
      partySize: covers,
      time: serviceClock(now),
      date: serviceDay(now),
    });
    if (!reserved.ok) return reserved;
    const assigned = callService(restaurant, "host", "assignTable", [reserved.reservation.id, tableId]);
    if (!assigned.ok) {
      callService(restaurant, "host", "cancelReservation", reserved.reservation.id);
      return assigned;
    }
  }

  const opened = callService(restaurant, "waiter", "openSession", tableId);
  if (!opened.ok) return opened;
  return { ...opened, created: true };
}

export function sendStagedItems(restaurant, sessionId, lines) {
  const staged = lines || [];
  if (!staged.length) return { ok: false, reason: "nothing_to_send", sent: [], writes: 0 };
  const before = existingOrder(restaurant.state, restaurant.state.sessions.find((row) => row.id === sessionId)?.tableId);
  const sent = [];
  for (const line of staged) {
    const result = callService(restaurant, "waiter", "addItem", [sessionId, {
      itemId: line.itemId,
      quantity: line.quantity,
      modifierIds: (line.modifiers || []).map((modifier) => modifier.id),
      instructions: line.instructions || "",
    }]);
    if (!result.ok) return { ...result, sent };
    sent.push({ item: result.item, course: line.course || null, ticket: result.ticket });
  }
  const order = restaurant.state.orders.find((row) => row.sessionId === sessionId) || null;
  const ticket = restaurant.state.tickets.find((row) => row.orderId === order?.id && (row.station || "pass") === "pass") || null;
  return {
    ok: true,
    sent,
    order,
    ticket,
    sameTicket: Boolean(before?.ticket && ticket && before.ticket.id === ticket.id),
    writes: 0,
  };
}

const FOOD_CATEGORIES = new Set(["breakfast", "brunch", "daytime", "evening", "desserts"]);

function normalizeStation(value) {
  const station = String(value || "").trim().toLowerCase();
  if (station === "kitchen" || station === "pass") return "pass";
  if (station === "bar" || station === "grill" || station === "pastry") return station;
  return null;
}

export function resolveStation(line) {
  if (line?.station) {
    const explicit = normalizeStation(line.station);
    if (!explicit) return { station: null, source: "product", reason: "station_not_recorded", writes: 0 };
    return { station: explicit, source: "product", writes: 0 };
  }
  const slug = String(line?.categorySlug || "").toLowerCase();
  if (slug === "drinks") return { station: "bar", source: "category", categorySlug: slug, writes: 0 };
  if (FOOD_CATEGORIES.has(slug)) return { station: "pass", source: "category", categorySlug: slug, writes: 0 };
  return { station: null, source: "missing", reason: "station_not_recorded", writes: 0 };
}

export function stationLabel(station) {
  if (station === "bar") return "Bar";
  if (station === "pass") return "Kitchen";
  if (station === "grill") return "Grill";
  if (station === "pastry") return "Pastry";
  return "Station not recorded";
}

export function unitPriceOf(line) {
  if (Number.isFinite(line?.unitPrice)) return line.unitPrice;
  const quantity = Number(line?.quantity);
  const price = Number(line?.price);
  if (!Number.isFinite(price) || !Number.isInteger(quantity) || quantity < 1) return null;
  return price / quantity;
}

export function sendToStation(restaurant, sessionId, lines, destination) {
  const staged = lines || [];
  const kitchen = [];
  const bar = [];
  const unassigned = [];
  staged.forEach((line) => {
    const resolved = resolveStation(line);
    if (resolved.station === "bar") bar.push({ ...line, station: "bar" });
    else if (resolved.station === "pass") kitchen.push({ ...line, station: "pass" });
    else unassigned.push(line);
  });
  const ticketsBefore = restaurant.state.tickets.length;
  if (destination === "bar") {
    return {
      ok: false,
      applied: false,
      reason: bar.length ? "bar_route_not_posted" : (unassigned.length ? "station_not_recorded" : "nothing_to_send"),
      sent: [],
      held: bar,
      skipped: kitchen.concat(unassigned),
      tickets: restaurant.state.tickets.length,
      writes: 0,
    };
  }
  if (destination !== "kitchen") {
    return { ok: false, reason: "station_not_recorded", sent: [], writes: 0 };
  }
  if (!kitchen.length) {
    return {
      ok: false,
      reason: unassigned.length && !bar.length ? "station_not_recorded" : "nothing_to_send",
      sent: [],
      held: bar.concat(unassigned),
      skipped: bar.concat(unassigned),
      tickets: ticketsBefore,
      writes: 0,
    };
  }
  const posted = sendStagedItems(restaurant, sessionId, kitchen);
  return {
    ...posted,
    held: bar.concat(unassigned),
    skipped: bar.concat(unassigned),
    tickets: restaurant.state.tickets.length,
    openedTicket: restaurant.state.tickets.length > ticketsBefore,
    writes: 0,
  };
}

export function markOrderServed(restaurant, orderId) {
  return callService(restaurant, "waiter", "markServed", orderId);
}

export function discountAttempt(restaurant) {
  const bill = restaurant.state.bills.find((row) => row.branchId === restaurant.state.branchId && row.status !== "paid") || null;
  const before = restaurant.state.revision;
  const plan = planDiscount({ role: "waiter", bill, amount: 1 });
  return {
    ok: false,
    applied: false,
    reason: plan.reason,
    revision: restaurant.state.revision,
    unchanged: restaurant.state.revision === before,
    writes: 0,
  };
}

export function checkTotal(sentItems, stagedLines) {
  const sent = (sentItems || []).map((item) => item.price);
  const waiting = (stagedLines || []).map((line) => line.price);
  if ([...sent, ...waiting].some((value) => !Number.isFinite(value))) return null;
  return [...sent, ...waiting].reduce((sum, value) => sum + value, 0);
}

export function selectionError(line, modifierIds) {
  const selected = modifierIds || [];
  const groups = new Map();
  for (const modifier of line?.modifiers || []) {
    if (modifier.required !== true) continue;
    const key = modifier.groupId || modifier.id;
    const group = groups.get(key) || {
      min: modifier.min ?? 1,
      max: modifier.max ?? 1,
      count: 0,
      name: modifier.groupName || modifier.name,
    };
    if (selected.includes(modifier.id)) group.count += 1;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.count < group.min) return `Choose ${group.name}.`;
    if (group.count > group.max) return `Choose no more than ${group.max} ${group.name}.`;
  }
  const optional = new Set();
  for (const id of selected) {
    const modifier = (line?.modifiers || []).find((row) => row.id === id);
    if (!modifier) return "That add-on is not on this product.";
    if (modifier.required === true) continue;
    if (optional.has(id)) return "That add-on is already selected.";
    optional.add(id);
  }
  return null;
}

export function stagedPrice(product, modifierIds, quantity) {
  const picked = (modifierIds || [])
    .map((id) => product.modifiers.find((modifier) => modifier.id === id))
    .filter(Boolean);
  if (picked.length !== (modifierIds || []).length) return null;
  const unit = product.price + picked.reduce((sum, modifier) => sum + modifier.price, 0);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99 || !Number.isFinite(unit)) return null;
  return { modifiers: picked, price: unit * qty, quantity: qty };
}

export function tableTone(status) {
  if (status === "occupied") return "dining";
  if (status === "assigned" || status === "combined") return "seated";
  if (status === "open") return "free";
  return "closed";
}

export function kitchenLabel(ticket, itemStatus) {
  if (itemStatus === "cancelled") return "Cancelled";
  if (itemStatus === "served" || ticket?.status === "served") return "Served";
  if (itemStatus === "ready" || ticket?.status === "ready") return "Ready";
  if (itemStatus === "preparing" || ticket?.status === "preparing") return "Preparing";
  if (itemStatus === "accepted" || ticket?.status === "accepted") return "Accepted";
  if (itemStatus === "cancelled") return "Cancelled";
  if (ticket?.status === "queued" || itemStatus === "ordered") return "Sent";
  return "Not sent";
}
