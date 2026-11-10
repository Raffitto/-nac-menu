/**
 * Local restaurant API. The browser never receives the database password.
 * Sessions are in-memory tokens for this process only.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "./passkeys.mjs";
import { GUEST_ORDER_MODE, OWNER_EMAILS, guestMenu, issueGuestToken, readGuestToken } from "./guestAccess.mjs";
import { verifySupabaseAccessToken } from "./hostedAuth.mjs";
import { selectStaffGrant } from "./staffGrant.mjs";
import { pathToFileURL } from "node:url";

const port = Number(process.env.LOCAL_API_PORT || 4193);
const devPassword = process.env.LOCAL_DEV_PASSWORD || "local-dev";
const dbHost = "127.0.0.1";
const dbPort = Number(process.env.LOCAL_DB_PORT || 54329);
const dbName = process.env.LOCAL_DB_NAME || "nac_reservations_dev";
const adminPool = new pg.Pool({
  host: dbHost,
  port: dbPort,
  database: dbName,
  user: "postgres",
  password: process.env.LOCAL_DB_PASSWORD,
});
let appPool = null;
const loginAttempts = new Map();
const SESSION_HOURS = 12;

const menu = JSON.parse(readFileSync(new URL("../../src/catalogue/guest-menu-baseline-khobar.json", import.meta.url)));
const menuById = new Map((menu.items || []).map((item) => [String(item.id), item]));
const addonById = new Map((menu.addOns || []).map((addon) => [String(addon.id), addon]));
const addonIdsByItem = new Map();
(menu.itemAddons || []).forEach((link) => {
  const key = String(link.item_id);
  if (!addonIdsByItem.has(key)) addonIdsByItem.set(key, new Set());
  addonIdsByItem.get(key).add(String(link.addon_id));
});
const allergenById = new Map((menu.allergens || []).map((row) => [String(row.id), row.name_en || row.name || null]));
const allergenIdsByItem = new Map();
(menu.itemAllergens || []).forEach((link) => {
  const key = String(link.item_id);
  if (!allergenIdsByItem.has(key)) allergenIdsByItem.set(key, []);
  const name = allergenById.get(String(link.allergen_id));
  if (name) allergenIdsByItem.get(key).push(name);
});

function menuItem(itemId) {
  return menuById.get(String(itemId)) || null;
}

function moneyAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match || String(value ?? "").trim() === "") return null;
  return Number(match[1]);
}

function minorUnits(value) {
  const amount = moneyAmount(value);
  if (amount == null) return null;
  return Math.round(amount * 100);
}

function lineMinor(name, quantity, modifierIds) {
  const matches = (menu.items || []).filter((row) => (row.name_en || row.name) === name);
  const units = [...new Set(matches.map((row) => minorUnits(row.price)).filter((amount) => amount != null))];
  const unit = units.length === 1 ? units[0] : null;
  let extra = 0;
  for (const id of modifierIds || []) {
    const amount = minorUnits(addonById.get(String(id))?.price);
    if (amount == null) return null;
    extra += amount;
  }
  if (unit == null || !Number.isInteger(quantity) || quantity < 1) return null;
  return (unit + extra) * quantity;
}

function linePrice(name, quantity, modifierIds) {
  const minor = lineMinor(name, quantity, modifierIds);
  return minor == null ? null : minor / 100;
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

async function loadGuestAccess(token) {
  const payload = readGuestToken(token);
  const client = await appPool.connect();
  try {
    await client.query("begin");
    const access = (await client.query(
      "select * from restaurant_guest_access where token_hash = $1",
      [hashToken(token)],
    )).rows[0];
    if (!access || access.id !== payload.aid) throw new Error("guest_access_invalid");
    if (access.revoked_at) throw new Error("guest_access_revoked");
    if (new Date(access.expires_at).getTime() < Date.now()) throw new Error("guest_access_expired");
    await client.query("select set_config('nac.branch', $1, true)", [access.branch_id]);
    const session = (await client.query(
      "select id, status, table_id from restaurant_sessions where id = $1",
      [access.session_id],
    )).rows[0];
    await client.query("commit");
    if (!session || session.status !== "open" || session.table_id !== access.table_id) throw new Error("session_not_open");
    return access;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function branchPilotEnabled(branchId) {
  try {
    const row = (await appPool.query(
      "select restaurant_pilot_enabled from restaurant_owner_settings where branch_id = $1",
      [branchId],
    )).rows[0];
    return row?.restaurant_pilot_enabled === true;
  } catch {
    return false;
  }
}

async function ownerSwitches(branchId) {
  try {
    const row = (await appPool.query(
      "select guest_ordering_enabled, guest_payments_enabled from restaurant_owner_settings where branch_id = $1",
      [branchId],
    )).rows[0];
    return {
      ordering: row?.guest_ordering_enabled === true,
      payments: row?.guest_payments_enabled === true,
    };
  } catch {
    return { ordering: false, payments: false };
  }
}

async function handleGuest(res, pathname, body) {
  if (pathname === "/guest/ordering-status") {
    let ordering = false;
    let payments = false;
    try {
      const access = await loadGuestAccess(body.token);
      const flags = await ownerSwitches(access.branch_id);
      ordering = flags.ordering;
      payments = flags.payments;
    } catch {
      ordering = false;
      payments = false;
    }
    send(res, 200, { ok: true, guestOrdering: ordering, guestPayments: payments, paymentCaptured: false });
    return true;
  }
  if (pathname === "/guest/menu") {
    const access = await loadGuestAccess(body.token);
    if (!(await ownerSwitches(access.branch_id)).ordering) throw new Error("guest_ordering_disabled");
    send(res, 200, {
      ok: true,
      mode: GUEST_ORDER_MODE,
      requiredModifiersConfigured: false,
      branchId: access.branch_id,
      tableId: access.table_id,
      expiresAt: access.expires_at,
      items: guestMenu(menu, addonById, addonIdsByItem, allergenIdsByItem),
    });
    return true;
  }
  if (pathname === "/guest/basket") {
    const access = await loadGuestAccess(body.token);
    if (!(await ownerSwitches(access.branch_id)).ordering) throw new Error("guest_ordering_disabled");
    const known = menuItem(body.itemId);
    const name = known?.name_en || known?.name || null;
    if (!known || known.active === false || known.sold_out === true || !name) throw new Error("item_not_in_menu");
    const quantity = Number(body.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("quantity_invalid");
    const modifierIds = Array.isArray(body.modifierIds) ? body.modifierIds.map(String) : [];
    const allowed = addonIdsByItem.get(String(known.id)) || new Set();
    if (modifierIds.some((id) => !allowed.has(id) || !addonById.has(id))) throw new Error("modifier_not_available");
    const price = linePrice(name, quantity, modifierIds);
    if (price == null) throw new Error("price_unconfigured");
    const key = body.clientKey ? String(body.clientKey).slice(0, 80) : "";
    if (key) {
      const existing = (await appPool.query(
        "select id from restaurant_guest_baskets where access_id = $1 and client_key = $2",
        [access.id, key],
      )).rows[0];
      if (existing) {
        send(res, 200, { ok: true, idempotent: true, paymentCaptured: false });
        return true;
      }
    }
    await appPool.query(
      `insert into restaurant_guest_baskets (access_id, item_id, item_name, quantity, modifier_ids, note, client_key)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [access.id, known.id, name, quantity, JSON.stringify(modifierIds), body.note ? String(body.note).slice(0, 140) : null, key || null],
    );
    send(res, 200, { ok: true, status: "draft", paymentCaptured: false });
    return true;
  }
  if (pathname === "/guest/submit") {
    if (GUEST_ORDER_MODE !== "staff_confirmation") throw new Error("guest_order_mode_not_enabled");
    const access = await loadGuestAccess(body.token);
    if (!(await ownerSwitches(access.branch_id)).ordering) throw new Error("guest_ordering_disabled");
    const key = String(body.idempotencyKey || "").slice(0, 80);
    if (!key) throw new Error("idempotency_key_required");
    const inserted = await appPool.query(
      "insert into restaurant_guest_submissions (access_id, idempotency_key) values ($1, $2) on conflict do nothing returning id",
      [access.id, key],
    );
    if (!inserted.rowCount) {
      send(res, 200, { ok: true, idempotent: true, status: "pending_staff", paymentCaptured: false });
      return true;
    }
    const updated = await appPool.query(
      "update restaurant_guest_baskets set status = 'pending_staff' where access_id = $1 and status = 'draft' returning id",
      [access.id],
    );
    send(res, 200, { ok: true, status: "pending_staff", lines: updated.rowCount, kitchenSubmitted: false, paymentCaptured: false });
    return true;
  }
  if (pathname === "/guest/plan") {
    const access = await loadGuestAccess(body.token);
    const flags = await ownerSwitches(access.branch_id);
    if (!flags.ordering) throw new Error("guest_ordering_disabled");
    if (!flags.payments) {
      send(res, 200, { ok: false, paymentCaptured: false, reason: "guest_payments_disabled" });
      return true;
    }
    const lines = (await appPool.query(
      "select item_name, quantity, modifier_ids from restaurant_guest_baskets where access_id = $1 and status in ('draft', 'pending_staff')",
      [access.id],
    )).rows;
    const minors = lines.map((line) => lineMinor(line.item_name, line.quantity, line.modifier_ids || []));
    const mine = minors.some((amount) => amount == null) ? null : minors.reduce((sum, amount) => sum + amount, 0) / 100;
    send(res, 200, {
      ok: true,
      mode: body.plan || "mine",
      mine,
      paymentCaptured: false,
      reason: "payment_not_authorized",
    });
    return true;
  }
  return false;
}

function limitedLogin(email) {
  const key = String(email || "").toLowerCase();
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((at) => now - at < 60000);
  recent.push(now);
  loginAttempts.set(key, recent);
  return recent.length > 30;
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": res.reqOrigin || "http://localhost:4192",
    "access-control-allow-headers": "authorization, content-type, x-nac-branch",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "origin",
  });
  res.end(JSON.stringify(body));
}

async function withStaff(email, branchId, fn) {
  const client = await appPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.email', $1, true)", [email]);
    await client.query("select set_config('nac.branch', $1, true)", [branchId]);
    const result = await fn(client);
    const notice = JSON.stringify({
      id: randomBytes(12).toString("hex"),
      branchId,
      revision: result?.revision ?? null,
    });
    await client.query("select pg_notify('restaurant_service', $1)", [notice]);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function reasonFrom(error) {
  const message = String(error?.message || "request_failed").split("\n")[0];
  return message.replaceAll(" ", "_");
}

async function snapshot(client, branchId) {
  const tables = (await client.query(
    `select t.id, t.branch_id, t.label, t.active, t.removed_at, t.hold,
            s.id as session_id, s.status as session_status,
            r.id as reservation_id, r.status as reservation_status
     from restaurant_tables t
     left join restaurant_sessions s on s.table_id = t.id and s.status = 'open'
     left join restaurant_reservations r on r.table_id = t.id and r.status in ('booked','arrived','seated')
     where t.branch_id = $1`,
    [branchId],
  )).rows;
  const joined = (await client.query(
    `select st.table_id, st.session_id, st.relationship
     from restaurant_session_tables st
     join restaurant_sessions s on s.id = st.session_id
     where s.branch_id = $1 and s.status = 'open'`,
    [branchId],
  )).rows;
  const guests = (await client.query(
    `select id, branch_id, name, phone, allergies, preferences, notes, vip
     from restaurant_guests where branch_id = $1`,
    [branchId],
  )).rows;
  const reservations = (await client.query(
    `select id, branch_id, guest_id, party_size, to_char(service_date, 'YYYY-MM-DD') as service_date, service_time, status, table_id, revision
     from restaurant_reservations where branch_id = $1 order by service_time nulls last, created_at`,
    [branchId],
  )).rows;
  const sessions = (await client.query(
    `select s.id, s.branch_id, s.reservation_id, s.table_id, s.status, s.revision, r.guest_id
     from restaurant_sessions s
     left join restaurant_reservations r on r.id = s.reservation_id
     where s.branch_id = $1`,
    [branchId],
  )).rows;
  const orders = (await client.query(
    `select id, session_id, branch_id, status from restaurant_orders where branch_id = $1`,
    [branchId],
  )).rows;
  const items = (await client.query(
    `select id, order_id, item_name, quantity, note, allergy_alert, status, status_at, modifier_ids
     from restaurant_order_items where branch_id = $1`,
    [branchId],
  )).rows;
  const bills = (await client.query(
    `select id, session_id, branch_id, status from restaurant_bills where branch_id = $1`,
    [branchId],
  )).rows;
  const waitlist = (await client.query(
    `select id, name, party_size, status, estimate_note from restaurant_waitlist
     where branch_id = $1 and status = 'waiting' order by created_at`,
    [branchId],
  )).rows;
  const layouts = (await client.query(
    `select id, name, status, document, revision from restaurant_floor_layouts
     where branch_id = $1 order by created_at desc`,
    [branchId],
  )).rows;
function sessionMinor(sessionId) {
    const orderIds = new Set(orders.filter((row) => row.session_id === sessionId).map((row) => row.id));
    const lines = items.filter((item) => orderIds.has(item.order_id) && item.status !== "cancelled");
    if (!lines.length) return null;
    const minors = lines.map((item) => lineMinor(item.item_name, item.quantity, item.modifier_ids || []));
    if (minors.some((amount) => amount == null)) return null;
    return minors.reduce((sum, amount) => sum + amount, 0);
  }
  function sessionTotal(sessionId) {
    const minor = sessionMinor(sessionId);
    return minor == null ? null : minor / 100;
  }
  function visitTotal(sessionId) {
    const base = sessionMinor(sessionId);
    if (base == null) return null;
    const discounts = adjustments
      .filter((row) => row.session_id === sessionId && row.kind === "discount" && Number.isInteger(row.amount_minor))
      .reduce((sum, row) => sum + row.amount_minor, 0);
    return Math.max(0, base - discounts) / 100;
  }
  function outstanding(sessionId) {
    const base = sessionMinor(sessionId);
    if (base == null) return null;
    const discounted = adjustments
      .filter((row) => row.session_id === sessionId && row.kind === "discount" && !row.item_id && Number.isInteger(row.amount_minor))
      .reduce((sum, row) => sum + row.amount_minor, 0);
    const itemDiscounts = adjustments
      .filter((row) => row.session_id === sessionId && row.kind === "discount" && row.item_id && Number.isInteger(row.amount_minor))
      .reduce((sum, row) => sum + row.amount_minor, 0);
    const allocated = adjustments
      .filter((row) => row.session_id === sessionId && row.kind === "split" && row.check_bill_id && Number.isInteger(row.amount_minor))
      .reduce((sum, row) => sum + row.amount_minor, 0);
    return Math.max(0, base - discounted - itemDiscounts - allocated) / 100;
  }
  const adjustments = (await client.query(
      `select id, bill_id, session_id, kind, item_id, basis, amount_minor, parts, reason, actor_email, idempotency_key, check_bill_id
     from restaurant_adjustments where branch_id = $1 order by created_at`,
    [branchId],
  )).rows;
  const version = (await client.query("select count(*)::int as revision from restaurant_audit_events")).rows[0].revision;
  const canContact = (await client.query("select public.restaurant_can($1, 'guest_contact') as ok", [branchId])).rows[0].ok;
  const joinedByTable = new Map(joined.filter((row) => row.relationship === "joined").map((row) => [row.table_id, row.session_id]));
  const primaryBySession = new Map(joined.filter((row) => row.relationship === "primary").map((row) => [row.session_id, row.table_id]));

  function tableStatus(row) {
    if (row.hold === "cleaning" || row.hold === "blocked") return row.hold;
    if (joinedByTable.has(row.id)) return "combined";
    if (row.session_status === "open") return "occupied";
    if (row.reservation_status === "seated" || row.reservation_status === "arrived" || row.reservation_status === "booked") {
      return row.reservation_status === "seated" ? "assigned" : "open";
    }
    return "open";
  }

  const guestOrdersPending = (await client.query(
    `select count(*)::int as count
     from restaurant_guest_baskets b
     join restaurant_guest_access a on a.id = b.access_id
     where a.branch_id = $1 and b.status = 'pending_staff' and a.revoked_at is null`,
    [branchId],
  )).rows[0].count;
  const state = {
    developmentDatabase: true,
    guestOrdersPending,
    branchId,
    revision: version,
    floors: [{ id: "indoor", branchId, name: "Indoor" }],
    tables: tables.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      floorId: "indoor",
      label: row.label,
      status: tableStatus(row),
      sessionId: row.session_id || joinedByTable.get(row.id) || null,
      active: row.active !== false && !row.removed_at,
      removed: Boolean(row.removed_at),
      minSeats: null,
      maxSeats: null,
      seats: null,
      capacity: "unverified",
      combinedWith: joinedByTable.has(row.id) ? primaryBySession.get(joinedByTable.get(row.id)) || null : null,
      hold: row.hold,
    })),
    guests: guests.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      name: row.name,
      phone: canContact ? row.phone : null,
      allergies: row.allergies,
      preferences: canContact ? row.preferences : null,
      notes: canContact ? row.notes : null,
      vip: row.vip === true,
    })),
    reservations: reservations.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      guestId: row.guest_id,
      partySize: row.party_size,
      date: row.service_date ? String(row.service_date).slice(0, 10) : null,
      time: row.service_time,
      status: row.status === "completed" ? "completed" : row.status,
      tableId: row.table_id,
      revision: row.revision,
    })),
    sessions: sessions.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      reservationId: row.reservation_id,
      guestId: row.guest_id,
      tableId: row.table_id,
      status: row.status,
      revision: row.revision,
      floorId: "indoor",
      combinedTableIds: joined.filter((link) => link.session_id === row.id && link.relationship === "joined").map((link) => link.table_id),
    })),
    orders: orders.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      branchId: row.branch_id,
      status: row.status,
      items: items.filter((item) => item.order_id === row.id).map((item) => ({
        id: item.id,
        itemId: item.id,
        name: item.item_name,
        price: linePrice(item.item_name, item.quantity, item.modifier_ids || []),
        status: item.status,
        statusAt: item.status_at ? new Date(item.status_at).toISOString() : null,
        modifiers: [],
        instructions: item.note,
        allergyAlert: item.allergy_alert,
      })),
    })),
    tickets: orders.filter((row) => sessions.some((session) => session.id === row.session_id && session.status === "open")).map((row) => {
      const rows = items.filter((item) => item.order_id === row.id && item.status !== "cancelled");
      const status = !rows.length
        ? "queued"
        : rows.every((item) => item.status === "served")
          ? "served"
          : rows.every((item) => item.status === "ready" || item.status === "served")
            ? "ready"
            : rows.some((item) => item.status === "preparing" || item.status === "ready")
              ? "preparing"
              : rows.some((item) => item.status === "accepted")
                ? "accepted"
                : "queued";
      return { id: `ticket:${row.id}`, orderId: row.id, sessionId: row.session_id, status, station: "pass" };
    }),
    bills: bills.map((row) => {
      const part = adjustments.find((entry) => entry.check_bill_id === row.id);
      const partAmount = part && Number.isInteger(part.amount_minor) ? part.amount_minor / 100 : null;
      return {
        id: row.id,
        sessionId: row.session_id,
        branchId: row.branch_id,
        status: row.status,
        total: part ? partAmount : sessionTotal(row.session_id),
        outstanding: part ? partAmount : outstanding(row.session_id),
        paid: false,
        partId: row.id.startsWith(`bill:${row.session_id}:`) && row.id !== `bill:${row.session_id}`
          ? row.id.slice(`bill:${row.session_id}:`.length)
          : null,
      };
    }),
    adjustments: adjustments.map((row) => ({
      id: row.id,
      billId: row.bill_id,
      sessionId: row.session_id,
      kind: row.kind,
      itemId: row.item_id,
      basis: row.basis,
      amount: Number.isInteger(row.amount_minor) ? row.amount_minor / 100 : null,
      checkBillId: row.check_bill_id,
      reason: row.reason,
      actorEmail: row.actor_email,
      paymentCaptured: false,
    })),
    payments: [],
    visits: sessions.filter((row) => row.status === "closed" && row.guest_id).map((row) => ({
      id: `visit:${row.id}`,
      sessionId: row.id,
      branchId: row.branch_id,
      guestId: row.guest_id,
      tableId: row.table_id,
      status: "completed",
      paymentCaptured: false,
      total: visitTotal(row.id),
    })),
    waitlist: waitlist.map((row) => ({
      id: row.id,
      name: row.name,
      partySize: row.party_size,
      status: row.status,
      estimateNote: row.estimate_note,
    })),
    layouts,
  };
  return { ok: true, state, revision: version, writes: 0 };
}

async function act(client, email, action, payload) {
  const grant = (await client.query(
    `select role, branch_id from restaurant_staff_grants where lower(email) = lower($1) and branch_id <> '*' limit 1`,
    [email],
  )).rows[0];
  if (!grant) throw new Error("branch_forbidden");
  if (action === "reserve") {
    const body = payload || {};
    const phone = body.phone ? String(body.phone).trim() : "";
    const matched = phone
      ? (await client.query(
        "select * from restaurant_guests where branch_id = $1 and phone = $2 order by created_at limit 1",
        [grant.branch_id, phone],
      )).rows[0]
      : null;
    const guest = matched || (await client.query(
      "select * from restaurant_create_guest($1, $2, $3)",
      [grant.branch_id, body.guestName, phone || null],
    )).rows[0];
    const reservation = (await client.query(
      "select * from restaurant_create_reservation($1, $2, $3, $4)",
      [guest.id, Number(body.partySize || 2), body.date || null, body.time || null],
    )).rows[0];
    return { ok: true, guest: { id: guest.id, name: guest.name }, reservation: { id: reservation.id } };
  }
  if (action === "markArrived") {
    const id = Array.isArray(payload) ? payload[0] : payload;
    const revision = (await client.query("select revision from restaurant_reservations where id = $1", [id])).rows[0]?.revision;
    await client.query("select restaurant_mark_arrived($1, $2)", [id, revision]);
    return { ok: true };
  }
  if (action === "assignTable") {
    const [reservationId, tableId] = payload;
    const revision = (await client.query("select revision from restaurant_reservations where id = $1", [reservationId])).rows[0]?.revision;
    await client.query("select restaurant_assign_table($1, $2, $3)", [reservationId, tableId, revision]);
    return { ok: true };
  }
  if (action === "openSession") {
    const tableId = Array.isArray(payload) ? payload[0] : payload;
    const reservation = (await client.query(
      `select id, revision from restaurant_reservations where table_id = $1 and status = 'seated' limit 1`,
      [tableId],
    )).rows[0];
    if (!reservation) throw new Error("reservation_not_seated");
    const sessionId = `session-${reservation.id}`;
    await client.query("select restaurant_open_session($1, $2, $3)", [sessionId, reservation.id, reservation.revision]);
    const orderId = `order-${reservation.id}`;
    await client.query("select restaurant_add_order($1, $2)", [orderId, sessionId]);
    return { ok: true };
  }
  if (action === "addItem") {
    const [sessionId, item] = payload;
    const order = (await client.query(
      "select id from restaurant_orders where session_id = $1 limit 1",
      [sessionId],
    )).rows[0];
    if (!order) throw new Error("order_not_found");
    const known = menuItem(item?.itemId);
    const name = known?.name_en || known?.name || null;
    if (!name) throw new Error("item_not_in_menu");
    const quantity = Number(item?.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("quantity_invalid");
    const modifierIds = Array.isArray(item?.modifierIds) ? item.modifierIds.map(String) : [];
    const allowed = addonIdsByItem.get(String(known.id)) || new Set();
    if (modifierIds.some((id) => !allowed.has(id) || !addonById.has(id))) throw new Error("modifier_not_available");
    const modifierNames = modifierIds.map((id) => addonById.get(id)?.name_en).filter(Boolean);
    const note = [item?.instructions, modifierNames.length ? modifierNames.join(", ") : null].filter(Boolean).join(" · ") || null;
    const allergyNames = allergenIdsByItem.get(String(known.id)) || [];
    const allergy = allergyNames.length ? allergyNames.join(", ") : null;
    const clientKey = item?.clientKey ? String(item.clientKey).slice(0, 80) : "";
    const inserted = clientKey
      ? (await client.query(
        "select id from restaurant_add_keyed_item($1, $2, $3, $4, $5, $6)",
        [order.id, name, quantity, note, allergy, clientKey],
      )).rows[0]
      : (await client.query(
        "select id from restaurant_add_item($1, $2, $3, $4, $5)",
        [order.id, name, quantity, note, allergy],
      )).rows[0];
    await client.query("select restaurant_set_item_modifiers($1, $2::jsonb)", [inserted.id, JSON.stringify(modifierIds)]);
    return { ok: true };
  }
  if (action === "markServed" || action === "setKitchenStatus") {
    const orderId = action === "markServed" ? (Array.isArray(payload) ? payload[0] : payload) : payload[0];
    const status = action === "markServed" ? "served" : payload[1];
    const id = String(orderId).startsWith("order-") ? orderId : (await client.query(
      "select id from restaurant_orders where id = $1 or session_id = $1 limit 1",
      [orderId],
    )).rows[0]?.id;
    await client.query("select restaurant_set_order_status($1, $2)", [id, status]);
    return { ok: true };
  }
  if (action === "setItemStatus") {
    const [itemId, status] = payload;
    await client.query("select restaurant_set_item_status($1, $2)", [itemId, status]);
    return { ok: true };
  }
  if (action === "transferTable") {
    const [sessionId, tableId] = payload;
    const revision = (await client.query("select revision from restaurant_sessions where id = $1", [sessionId])).rows[0]?.revision;
    await client.query("select restaurant_move_table($1, $2, $3)", [sessionId, tableId, revision]);
    return { ok: true };
  }
  if (action === "combineTables") {
    const [sessionId, tableIds] = payload;
    let revision = (await client.query("select revision from restaurant_sessions where id = $1", [sessionId])).rows[0]?.revision;
    for (const tableId of tableIds || []) {
      await client.query("select restaurant_join_tables($1, $2, $3)", [sessionId, tableId, revision]);
      revision += 1;
    }
    return { ok: true };
  }
  if (action === "cancelReservation") {
    const id = Array.isArray(payload) ? payload[0] : payload;
    const revision = (await client.query("select revision from restaurant_reservations where id = $1", [id])).rows[0]?.revision;
    await client.query("select restaurant_cancel_reservation($1, $2)", [id, revision]);
    return { ok: true };
  }
  if (action === "bookWaitlist") {
    const id = Array.isArray(payload) ? payload[0] : payload?.id;
    const date = Array.isArray(payload) ? payload[1] : payload?.date;
    const time = Array.isArray(payload) ? payload[2] : payload?.time;
    await client.query("select restaurant_book_waitlist($1, $2, $3)", [id, date || null, time || null]);
    return { ok: true };
  }
  if (action === "cancelWaitlist") {
    await client.query("select restaurant_cancel_waitlist($1)", [payload?.id || payload]);
    return { ok: true };
  }
  if (action === "seatWaitlist") {
    const reservation = (await client.query(
      "select restaurant_seat_waitlist($1, $2) as id",
      [payload.id, payload.tableId],
    )).rows[0];
    return { ok: true, reservation };
  }
  if (action === "updateGuest") {
    await client.query("select restaurant_update_guest($1, $2::jsonb)", [payload.id, JSON.stringify(payload.patch || {})]);
    return { ok: true };
  }
  if (action === "addWaitlist") {
    await client.query("select restaurant_add_waitlist($1, $2, $3)", [grant.branch_id, payload.guestName || payload.name, Number(payload.partySize)]);
    return { ok: true };
  }
  if (action === "setTableHold") {
    await client.query("select restaurant_set_table_hold($1, $2)", [payload[0], payload[1]]);
    return { ok: true };
  }
  if (action === "saveLayout") {
    const allowed = (await client.query("select public.restaurant_can($1, 'layout_write') as ok", [grant.branch_id])).rows[0].ok;
    if (!allowed) throw new Error("role_forbidden");
    const layouts = Array.isArray(payload.document?.layouts) ? payload.document.layouts : [];
    if (layouts.length) {
      const kept = new Set();
      layouts.forEach((layout) => {
        (layout.tables || []).forEach((table) => {
          if (table?.id && table.active !== false && !table.removed) kept.add(String(table.id));
        });
      });
      const busy = (await client.query(
        `select id from restaurant_tables t
         where t.branch_id = $1 and (
           exists (select 1 from restaurant_sessions s where s.table_id = t.id and s.status = 'open')
           or exists (select 1 from restaurant_reservations r where r.table_id = t.id and r.status = 'seated')
         )`,
        [grant.branch_id],
      )).rows;
      if (busy.some((row) => !kept.has(row.id))) throw new Error("active_service_protected");
    }
    const saved = (await client.query(
      "select id, revision from restaurant_save_layout($1, $2, $3::jsonb)",
      [grant.branch_id, payload.name || "Draft", JSON.stringify(payload.document || {})],
    )).rows[0];
    await client.query("select restaurant_publish_layout($1, $2)", [saved.id, saved.revision]);
    return { ok: true };
  }
  if (action === "openBill") {
    const sessionId = Array.isArray(payload) ? payload[0] : payload;
    await client.query("select restaurant_open_bill($1, $2)", [`bill:${sessionId}`, sessionId]);
    return { ok: true };
  }
  if (action === "pay") {
    return { ok: false, reason: "payment_not_authorized" };
  }
  if (action === "discountBill" || action === "voidItem" || action === "splitBill") {
    const body = payload || {};
    const reason = String(body.reason || "").trim();
    if (!reason) throw new Error("reason_required");
    if (body.basis === "guest") throw new Error("guest_assignment_missing");
    const bill = (await client.query(
      "select id, session_id, status from restaurant_bills where id = $1 or session_id = $1 limit 1",
      [body.billId || body.sessionId],
    )).rows[0];
    if (!bill || String(bill.id).includes(":check:")) throw new Error("bill_not_found");
    const key = body.idempotencyKey ? String(body.idempotencyKey) : null;
    if (key) {
      const existing = (await client.query(
        "select id from restaurant_adjustments where bill_id = $1 and idempotency_key = $2",
        [bill.id, key],
      )).rows[0];
      if (existing) return { ok: true, paymentCaptured: false, idempotent: true };
    }
    const lines = (await client.query(
      `select i.id, i.item_name, i.quantity, i.modifier_ids, i.status
       from restaurant_order_items i
       join restaurant_orders o on o.id = i.order_id
       where o.session_id = $1 and i.status <> 'cancelled'`,
      [bill.session_id],
    )).rows;
    const priced = lines.map((line) => ({
      ...line,
      minor: lineMinor(line.item_name, line.quantity, line.modifier_ids || []),
    }));
    if (priced.some((line) => line.minor == null)) throw new Error("price_unconfigured");
    const totalMinor = priced.reduce((sum, line) => sum + line.minor, 0);
    const prior = (await client.query(
      "select kind, item_id, amount_minor, check_bill_id from restaurant_adjustments where bill_id = $1",
      [bill.id],
    )).rows;
    const usedMinor = prior.reduce((sum, row) => {
      if (!Number.isInteger(row.amount_minor)) return sum;
      if (row.kind === "discount") return sum + row.amount_minor;
      if (row.kind === "split" && row.check_bill_id) return sum + row.amount_minor;
      return sum;
    }, 0);
    const availableMinor = totalMinor - usedMinor;
    if (action === "discountBill") {
      const target = body.itemId ? priced.find((line) => line.id === body.itemId) : null;
      if (body.itemId && !target) throw new Error("item_not_found");
      const baseMinor = target ? target.minor : availableMinor;
      const basis = body.basis === "amount" ? "amount" : "percent";
      const value = Number(body.value);
      const amountMinor = basis === "percent" ? Math.round(baseMinor * value / 100) : Math.round(value * 100);
      if (!Number.isFinite(value) || value <= 0 || (basis === "percent" && value > 100) || amountMinor <= 0 || amountMinor > baseMinor || amountMinor > availableMinor) {
        throw new Error("discount_exceeds_total");
      }
      await client.query(
        "select restaurant_record_adjustment($1, 'discount', $2, $3, $4, null, $5, $6, null)",
        [bill.id, target ? target.id : null, basis, amountMinor, reason, key],
      );
      return { ok: true, paymentCaptured: false };
    }
    if (action === "voidItem") {
      await client.query(
        "select restaurant_record_adjustment($1, 'void', $2, 'item', null, null, $3, $4, null)",
        [bill.id, body.itemId, reason, key],
      );
      return { ok: true, paymentCaptured: false };
    }
    if (availableMinor <= 0) throw new Error("discount_exceeds_total");
    const chosen = Array.isArray(body.itemIds) && body.itemIds.length
      ? priced.filter((line) => body.itemIds.includes(line.id))
      : null;
    if (chosen && chosen.length !== body.itemIds.length) throw new Error("item_not_found");
    const groups = chosen
      ? [chosen]
      : null;
    if (groups) {
      const selectedMinor = chosen.reduce((sum, line) => sum + line.minor, 0);
      if (selectedMinor <= 0 || selectedMinor > availableMinor) throw new Error("discount_exceeds_total");
      const checkId = `${bill.id}:check:items:${key || randomBytes(4).toString("hex")}`;
      await client.query("select restaurant_open_unpaid_check($1, $2)", [bill.session_id, checkId]);
      await client.query(
        "select restaurant_record_adjustment($1, 'split', null, 'items', $2, $3, $4, $5, $6)",
        [bill.id, selectedMinor, chosen.length, reason, key, checkId],
      );
      return { ok: true, paymentCaptured: false, checks: [checkId] };
    }
    const parts = Number(body.parts || 2);
    if (!Number.isInteger(parts) || parts < 2 || parts > 12) throw new Error("split_not_supported");
    const baseShare = Math.floor(availableMinor / parts);
    const remainder = availableMinor - baseShare * parts;
    const checks = [];
    for (let index = 0; index < parts; index += 1) {
      const share = baseShare + (index === parts - 1 ? remainder : 0);
      const checkId = `${bill.id}:check:${index + 1}:${key || "equal"}`;
      await client.query("select restaurant_open_unpaid_check($1, $2)", [bill.session_id, checkId]);
      await client.query(
        "select restaurant_record_adjustment($1, 'split', null, 'equal', $2, $3, $4, $5, $6)",
        [bill.id, share, parts, reason, key ? `${key}:${index + 1}` : null, checkId],
      );
      checks.push(checkId);
    }
    return { ok: true, paymentCaptured: false, checks };
  }
  if (action === "closeTable") {
    const sessionId = Array.isArray(payload) ? payload[0] : payload;
    await client.query("select restaurant_close_unpaid($1)", [sessionId]);
    return { ok: true };
  }
  if (action === "setRestaurantPilot") {
    if (!OWNER_EMAILS.has(String(email || "").toLowerCase())) throw new Error("owner_required");
    const saved = (await client.query(
      "select restaurant_pilot_enabled, guest_ordering_enabled, guest_payments_enabled from restaurant_set_pilot_mode($1, $2)",
      [payload?.branchId, payload?.enabled === true],
    )).rows[0];
    return { ok: true, ...saved, paymentCaptured: false };
  }
  if (action === "setOwnerControls") {
    if (!OWNER_EMAILS.has(String(email || "").toLowerCase())) throw new Error("owner_required");
    const saved = (await client.query(
      "select guest_ordering_enabled, guest_payments_enabled from restaurant_set_owner_controls($1, $2, $3)",
      [payload?.branchId, payload?.guestOrdering === true, payload?.guestPayments === true],
    )).rows[0];
    return { ok: true, ...saved };
  }
  if (action === "issueGuestAccess") {
    const allowed = (await client.query("select public.restaurant_can($1, 'service_write') as ok", [grant.branch_id])).rows[0].ok;
    if (!allowed) throw new Error("role_forbidden");
    const session = (await client.query(
      "select id, table_id, branch_id, status from restaurant_sessions where id = $1",
      [payload?.sessionId],
    )).rows[0];
    if (!session || session.status !== "open" || session.branch_id !== grant.branch_id) throw new Error("session_not_open");
    const accessId = randomUUID();
    const issued = issueGuestToken({
      sessionId: session.id,
      tableId: session.table_id,
      branchId: session.branch_id,
      accessId,
    });
    await client.query(
      `insert into restaurant_guest_access (id, branch_id, session_id, table_id, label, token_hash, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [accessId, session.branch_id, session.id, session.table_id, String(payload?.label || "Guest").slice(0, 40), hashToken(issued.token), issued.expiresAt],
    );
    return { ok: true, accessId, token: issued.token, expiresAt: issued.expiresAt, mode: GUEST_ORDER_MODE, paymentCaptured: false };
  }
  if (action === "revokeGuestAccess") {
    const allowed = (await client.query("select public.restaurant_can($1, 'service_write') as ok", [grant.branch_id])).rows[0].ok;
    if (!allowed) throw new Error("role_forbidden");
    const updated = await client.query(
      "update restaurant_guest_access set revoked_at = now() where id = $1 and branch_id = $2 and revoked_at is null",
      [payload?.id, grant.branch_id],
    );
    if (!updated.rowCount) throw new Error("guest_access_invalid");
    return { ok: true };
  }
  if (action === "confirmGuestOrder" || action === "rejectGuestOrder") {
    const allowed = (await client.query("select public.restaurant_can($1, 'service_write') as ok", [grant.branch_id])).rows[0].ok;
    if (!allowed) throw new Error("role_forbidden");
    const access = (await client.query(
      "select id, session_id, branch_id from restaurant_guest_access where id = $1 and branch_id = $2 and revoked_at is null",
      [payload?.id, grant.branch_id],
    )).rows[0];
    if (!access) throw new Error("guest_access_invalid");
    if (action === "rejectGuestOrder") {
      await client.query(
        "update restaurant_guest_baskets set status = 'rejected' where access_id = $1 and status = 'pending_staff'",
        [access.id],
      );
      return { ok: true, paymentCaptured: false };
    }
    const order = (await client.query("select id from restaurant_orders where session_id = $1 limit 1", [access.session_id])).rows[0];
    if (!order) throw new Error("order_not_found");
    const lines = (await client.query(
      "select id, item_name, quantity, modifier_ids, note from restaurant_guest_baskets where access_id = $1 and status = 'pending_staff'",
      [access.id],
    )).rows;
    for (const line of lines) {
      const modifiers = Array.isArray(line.modifier_ids) ? line.modifier_ids : JSON.parse(line.modifier_ids || "[]");
      const inserted = (await client.query(
        "select id from restaurant_add_keyed_item($1, $2, $3, $4, $5, $6)",
        [order.id, line.item_name, line.quantity, line.note, null, `guest:${line.id}`],
      )).rows[0];
      await client.query("select restaurant_set_item_modifiers($1, $2::jsonb)", [inserted.id, JSON.stringify(modifiers)]);
      await client.query("update restaurant_guest_baskets set status = 'confirmed' where id = $1", [line.id]);
    }
    return { ok: true, confirmed: lines.length, paymentCaptured: false };
  }
  throw new Error("action_not_in_development_api");
}

const authFailures = new Map();

function limitedAuth(key) {
  const now = Date.now();
  const recent = (authFailures.get(key) || []).filter((stamp) => now - stamp < 60000);
  recent.push(now);
  authFailures.set(key, recent);
  return recent.length > 60;
}

export async function handleNodeRequest(req, res) {
  const origin = req.headers.origin || "http://localhost:4192";
  res.reqOrigin = origin;
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1");
  const body = await new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (Buffer.concat(chunks).length > 100000) {
        resolve({ __invalidJson: true, __tooLarge: true });
        return;
      }
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({ __invalidJson: true });
      }
    });
  });
  if (body?.__invalidJson) {
    send(res, body.__tooLarge ? 413 : 400, { ok: false, reason: body.__tooLarge ? "payload_too_large" : "invalid_json" });
    return;
  }
  try {
    const requestId = req.headers["x-request-id"] || randomBytes(8).toString("hex");
    res.setHeader("x-request-id", requestId);
    const started = Date.now();
    res.on("finish", () => {
      if (url.pathname === "/events") return;
      process.stdout.write(`${JSON.stringify({
        requestId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        ms: Date.now() - started,
      })}\n`);
    });
    if (url.pathname === "/pilot-status") {
      let restaurantPilot = false;
      let guestOrdering = false;
      let guestPayments = false;
      try {
        const rows = (await appPool.query(
          "select restaurant_pilot_enabled, guest_ordering_enabled, guest_payments_enabled from restaurant_owner_settings",
        )).rows;
        restaurantPilot = rows.some((row) => row.restaurant_pilot_enabled === true);
        guestOrdering = rows.some((row) => row.guest_ordering_enabled === true);
        guestPayments = rows.some((row) => row.guest_payments_enabled === true);
      } catch {
        restaurantPilot = false;
        guestOrdering = false;
        guestPayments = false;
      }
      send(res, 200, { ok: true, restaurantPilot, guestOrdering, guestPayments, paymentCaptured: false, mode: "test" });
      return;
    }
    if (url.pathname === "/health") {
      const ping = await appPool.query("select 1 as ok");
      send(res, 200, {
        ok: ping.rows[0].ok === 1,
        database: process.env.RESTAURANT_AUTH_MODE === "supabase" ? "supabase" : "local",
        production: false,
        db: "up",
        realtime: process.env.RESTAURANT_AUTH_MODE === "supabase" ? "poll" : "events",
      });
      return;
    }
    if (process.env.RESTAURANT_AUTH_MODE === "supabase" && (url.pathname === "/login" || url.pathname.startsWith("/passkey/"))) {
      send(res, 403, { ok: false, reason: "dev_auth_disabled" });
      return;
    }
    if (url.pathname === "/login" && req.method === "POST") {
      if (limitedLogin(body.email)) {
        send(res, 429, { ok: false, reason: "rate_limited" });
        return;
      }
      if (body.password !== devPassword) {
        send(res, 401, { ok: false, reason: "sign_in_failed" });
        return;
      }
      const row = (await appPool.query(
        `select role, branch_id from restaurant_staff_grants
         where lower(email) = lower($1) and ($2::text is null or role = $2) and branch_id <> '*'
           and revoked_at is null
         limit 1`,
        [body.email, body.role || null],
      )).rows[0];
      if (!row) {
        send(res, 403, { ok: false, reason: "branch_forbidden" });
        return;
      }
      const token = randomBytes(24).toString("hex");
      const email = String(body.email).toLowerCase();
      await appPool.query(
        `insert into restaurant_dev_sessions (token_hash, email, role, branch_id, expires_at)
         values ($1, $2, $3, $4, now() + interval '12 hours')`,
        [hashToken(token), email, row.role, row.branch_id],
      );
      send(res, 200, { ok: true, token, email, role: row.role, branchId: row.branch_id, expiresInHours: SESSION_HOURS });
      return;
    }
    if (url.pathname === "/passkey/login/options" && req.method === "POST") {
      const email = String(body.email || "").toLowerCase();
      const credentials = (await appPool.query(
        "select credential_id from restaurant_passkeys where lower(email) = lower($1) and revoked_at is null",
        [email],
      )).rows;
      if (!credentials.length) {
        send(res, 404, { ok: false, reason: "passkey_not_registered" });
        return;
      }
      const options = await authenticationOptions(email, credentials.map((row) => row.credential_id));
      send(res, 200, options);
      return;
    }
    if (url.pathname === "/passkey/login/verify" && req.method === "POST") {
      const email = String(body.email || "").toLowerCase();
      const credential = (await appPool.query(
        "select credential_id, public_key, counter from restaurant_passkeys where credential_id = $1 and lower(email) = lower($2) and revoked_at is null",
        [body.response?.id, email],
      )).rows[0];
      if (!credential) {
        send(res, 401, { ok: false, reason: "passkey_not_registered" });
        return;
      }
      const nextCounter = await verifyAuthentication(email, body.response, credential);
      await appPool.query("update restaurant_passkeys set counter = $2 where credential_id = $1", [credential.credential_id, nextCounter]);
      const row = (await appPool.query(
        `select role, branch_id from restaurant_staff_grants
         where lower(email) = lower($1) and ($2::text is null or role = $2) and branch_id <> '*' and revoked_at is null
         limit 1`,
        [email, body.role || null],
      )).rows[0];
      if (!row) {
        send(res, 403, { ok: false, reason: "branch_forbidden" });
        return;
      }
      const token = randomBytes(24).toString("hex");
      await appPool.query(
        `insert into restaurant_dev_sessions (token_hash, email, role, branch_id, expires_at)
         values ($1, $2, $3, $4, now() + interval '12 hours')`,
        [hashToken(token), email, row.role, row.branch_id],
      );
      send(res, 200, { ok: true, token, email, role: row.role, branchId: row.branch_id, expiresInHours: SESSION_HOURS });
      return;
    }
    if (url.pathname.startsWith("/guest/") && req.method === "POST") {
      if (await handleGuest(res, url.pathname, body)) return;
    }
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
    const session = await loadSession(token, req.headers);
    if (session?.error) {
      send(res, session.error === "rate_limited" ? 429 : 403, { ok: false, reason: session.error, paymentCaptured: false });
      return;
    }
    if (!session) {
      send(res, 401, { ok: false, reason: "sign_in_required" });
      return;
    }
    const ownerControl = url.pathname === "/act" && (body.action === "setRestaurantPilot" || body.action === "setOwnerControls");
    if (url.pathname !== "/logout" && !ownerControl && !(await branchPilotEnabled(session.branchId))) {
      send(res, 403, { ok: false, reason: "pilot_disabled", paymentCaptured: false });
      return;
    }
    if (url.pathname === "/passkey/register/options" && req.method === "POST") {
      const credentials = (await appPool.query(
        "select credential_id from restaurant_passkeys where lower(email) = lower($1) and revoked_at is null",
        [session.email],
      )).rows;
      const options = await registrationOptions(session.email, credentials.map((row) => row.credential_id));
      send(res, 200, options);
      return;
    }
    if (url.pathname === "/passkey/register/verify" && req.method === "POST") {
      const credential = await verifyRegistration(session.email, body.response);
      await appPool.query(
        `insert into restaurant_passkeys (credential_id, email, public_key, counter)
         values ($1, $2, $3, $4)
         on conflict (credential_id) do nothing`,
        [credential.id, session.email, Buffer.from(credential.publicKey), credential.counter],
      );
      send(res, 200, { ok: true, stored: "public_key_only" });
      return;
    }
    if (url.pathname === "/events" && req.method === "GET") {
      if (process.env.RESTAURANT_AUTH_MODE === "supabase") {
        send(res, 200, { ok: true, mode: "poll", realtime: "poll" });
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": res.reqOrigin || "http://localhost:4192",
      });
      res.write(": connected\n\n");
      const listener = new pg.Client({
        host: dbHost,
        port: dbPort,
        database: dbName,
        user: "nac_restaurant_api",
        password: process.env.LOCAL_API_ROLE_PASSWORD,
      });
      await listener.connect();
      await listener.query("listen restaurant_service");
      const onNote = (message) => {
        let notice = null;
        try {
          notice = JSON.parse(message.payload);
        } catch {
          notice = { id: message.payload, branchId: message.payload };
        }
        if (notice?.branchId !== session.branchId) return;
        res.write(`id: ${notice.id}\ndata: ${JSON.stringify(notice)}\n\n`);
      };
      listener.on("notification", onNote);
      req.on("close", () => {
        listener.removeListener("notification", onNote);
        listener.end().catch(() => {});
      });
      return;
    }
    if (url.pathname === "/logout" && req.method === "POST") {
      await appPool.query(
        "update restaurant_dev_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
        [hashToken(token)],
      );
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/state") {
      const data = await withStaff(session.email, session.branchId, (client) => snapshot(client, session.branchId));
      send(res, 200, { ...data, role: session.role, email: session.email });
      return;
    }
    if (url.pathname === "/act" && req.method === "POST") {
      const result = await withStaff(session.email, session.branchId, async (client) => {
        const current = (await client.query("select count(*)::int as revision from restaurant_audit_events")).rows[0].revision;
        if (body.expectedRevision != null && Number(body.expectedRevision) !== current && body.action !== "pay") {
          return { ok: false, reason: "service_conflict" };
        }
        const acted = await act(client, session.email, body.action, body.payload);
        const next = await snapshot(client, session.branchId);
        return { ...next, ...acted, state: next.state, revision: next.revision };
      });
      send(res, result.ok === false ? 409 : 200, result);
      return;
    }
    send(res, 404, { ok: false, reason: "not_found" });
  } catch (error) {
    send(res, 400, { ok: false, reason: reasonFrom(error) });
  }
}

async function loadSupabaseSession(token, headers) {
  const ip = String(headers["x-nf-client-connection-ip"] || headers["x-forwarded-for"] || "local").split(",")[0].trim();
  if (limitedAuth(ip)) return { error: "rate_limited" };
  const user = await verifySupabaseAccessToken(token);
  if (!user?.email) return null;
  const grants = (await appPool.query(
    `select role, branch_id from restaurant_staff_grants
     where lower(email) = lower($1) and revoked_at is null and branch_id <> '*'`,
    [user.email],
  )).rows;
  const selected = selectStaffGrant(grants, headers["x-nac-branch"]);
  if (!selected.ok) return { error: selected.reason };
  return { email: user.email, role: selected.role, branchId: selected.branchId };
}

async function loadSession(token, headers = {}) {
  if (process.env.RESTAURANT_AUTH_MODE === "supabase") return loadSupabaseSession(token, headers);
  if (!token) return null;
  const row = (await appPool.query(
    `select s.email, s.role, s.branch_id
     from restaurant_dev_sessions s
     join restaurant_staff_grants g
       on lower(g.email) = lower(s.email) and g.role = s.role and g.branch_id = s.branch_id and g.revoked_at is null
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`,
    [hashToken(token)],
  )).rows[0];
  if (!row) return null;
  return { email: row.email, role: row.role, branchId: row.branch_id };
}

export async function ensureRestaurantPool() {
  if (appPool) return appPool;
  if (process.env.RESTAURANT_DATABASE_URL) {
    appPool = new pg.Pool({
      connectionString: process.env.RESTAURANT_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 1000,
    });
    await appPool.query("select 1");
    return appPool;
  }
  await assertMigrated();
  return appPool;
}

async function assertMigrated() {
  if (!process.env.LOCAL_API_ROLE_PASSWORD) {
    throw new Error("LOCAL_API_ROLE_PASSWORD is missing. Run scripts/local-restaurant/migrate.sh");
  }
  const admin = await adminPool.connect();
  try {
    const ready = await admin.query(`
      select
        to_regclass('public.restaurant_dev_sessions') as sessions,
        to_regprocedure('public.restaurant_set_item_modifiers(uuid, jsonb)') as modifiers,
        exists (select 1 from pg_roles where rolname = 'nac_restaurant_api' and rolsuper = false and rolbypassrls = false) as api_role
    `);
    const row = ready.rows[0];
    if (!row.sessions || !row.modifiers || row.api_role !== true) {
      throw new Error("Restaurant migrations are not applied. Run scripts/local-restaurant/migrate.sh");
    }
  } finally {
    admin.release();
  }
  appPool = new pg.Pool({
    host: dbHost,
    port: dbPort,
    database: dbName,
    user: "nac_restaurant_api",
    password: process.env.LOCAL_API_ROLE_PASSWORD,
  });
}

export async function handleWebRequest(request) {
  await ensureRestaurantPool();
  const url = new URL(request.url);
  let pathname = url.pathname;
  for (const prefix of ["/api/restaurant", "/.netlify/functions/restaurant"]) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      pathname = pathname.slice(prefix.length) || "/";
      break;
    }
  }
  const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  const headers = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const req = {
    method: request.method,
    url: `${pathname}${url.search}`,
    headers,
    on(event, callback) {
      if (event === "data" && text) callback(Buffer.from(text));
      if (event === "end") queueMicrotask(callback);
    },
  };
  let status = 200;
  const headerBag = {};
  let payload = "";
  const res = {
    reqOrigin: headers.origin || "",
    statusCode: 200,
    setHeader(name, value) { headerBag[name] = value; },
    writeHead(code, extra) {
      status = code;
      if (extra) Object.assign(headerBag, extra);
    },
    end(body) { payload = body || ""; },
    write() {},
    on() {},
  };
  await handleNodeRequest(req, res);
  return new Response(payload, { status, headers: headerBag });
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  assertMigrated().then(() => {
    const server = http.createServer(handleNodeRequest);
    server.listen(port, "127.0.0.1", () => {
      process.stdout.write(`local restaurant api on 127.0.0.1:${port}\n`);
    });
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
