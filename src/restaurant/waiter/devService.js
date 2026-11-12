/**
 * Local development client for the waiter POS.
 * The browser receives a staff token, never the database password.
 * Simulation stays on the in-memory service unless databaseMode is on.
 */
const BASE = process.env.REACT_APP_RESTAURANT_API || "http://127.0.0.1:4193";
const KEY = "nac-dev-restaurant-token";

export function emptyServiceState() {
  return {
    developmentDatabase: true,
    branchId: "khobar",
    revision: 0,
    floors: [{ id: "indoor", branchId: "khobar", name: "Indoor" }],
    tables: [],
    guests: [],
    reservations: [],
    sessions: [],
    orders: [],
    tickets: [],
    bills: [],
    payments: [],
    visits: [],
    waitlist: [],
  };
}

export function devToken() {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(KEY) || "";
}

export function setDevToken(token) {
  if (typeof sessionStorage === "undefined") return;
  if (token) sessionStorage.setItem(KEY, token);
  else sessionStorage.removeItem(KEY);
}

async function request(path, body) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        authorization: devToken() ? `Bearer ${devToken()}` : "",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
  } catch {
    return { ok: false, reason: "service_unavailable" };
  }
}

export function devLogin(email, password, role) {
  return request("/login", { email, password, role });
}

export function devLogout() {
  return request("/logout", {});
}

export function devState() {
  return request("/state");
}

export function devAct(action, payload, expectedRevision) {
  return request("/act", { action, payload, expectedRevision });
}

export function devListen(onEvent) {
  if (typeof fetch === "undefined" || !devToken()) return () => {};
  const controller = new AbortController();
  fetch(`${BASE}/events`, {
    headers: { authorization: `Bearer ${devToken()}` },
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("data:")) {
        buffer = "";
        onEvent();
      }
    }
  }).catch(() => {});
  return () => controller.abort();
}

export async function openTableOnServer(state, { tableId, partySize, guestName, now = new Date() }) {
  const existing = (state.sessions || []).find((row) => row.tableId === tableId && row.status === "open");
  if (existing) return { ok: true, created: false, session: existing, state, revision: state.revision };
  const seated = (state.reservations || []).find((row) => row.tableId === tableId && row.status === "seated");
  let revision = state.revision;
  if (!seated) {
    const covers = Number(partySize);
    if (!Number.isInteger(covers) || covers < 1 || covers > 20) return { ok: false, reason: "party_size_invalid" };
    const name = String(guestName || "Walk-in").trim().slice(0, 80) || "Walk-in";
    const reserved = await devAct("reserve", {
      guestName: name,
      partySize: covers,
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    }, revision);
    if (!reserved.ok) return reserved;
    revision = reserved.revision;
    const assigned = await devAct("assignTable", [reserved.reservation.id, tableId], revision);
    if (!assigned.ok) return assigned;
    revision = assigned.revision;
  }
  const opened = await devAct("openSession", tableId, revision);
  if (!opened.ok) return opened;
  const session = (opened.state.sessions || []).find((row) => row.tableId === tableId && row.status === "open") || null;
  return { ok: true, created: true, session, state: opened.state, revision: opened.revision };
}
