/**
 * Waiter POS client. Network calls go through the shared restaurant API client.
 * Hosted mode uses the Supabase session. Local mode keeps the development token.
 */
import {
  devAct,
  devJson,
  devListen,
  devLogin,
  devState,
  devToken,
  setDevToken,
} from "../devApi/client";

export { devAct, devListen, devLogin, devState, devToken, setDevToken };

export function devLogout() {
  return devJson("/logout");
}

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
