import React, { useEffect, useMemo, useRef, useState } from "react";
import { openSimulatedService } from "../contracts";
import { loadServiceSnapshot, saveServiceSnapshot } from "../model";
import {
  guestName,
  openSessionForTable,
  orderForSession,
  reservationByTable,
  ticketForOrder,
} from "../service/serviceShared";
import { khobarCatalogueLines, menuFromLines } from "./catalogueView";
import {
  devAct,
  devListen,
  devLogin,
  devLogout,
  devState,
  devToken,
  emptyServiceState,
  openTableOnServer,
  setDevToken,
} from "./devService";
import {
  COURSES,
  checkTotal,
  discountAttempt,
  elapsedLabel,
  groupCatalogue,
  kitchenLabel,
  markOrderServed,
  noticeFor,
  openTableOrder,
  placeTables,
  posMoney,
  readMap,
  rememberCourses,
  rememberSeating,
  seatCaption,
  resolveStation,
  sendToStation,
  stagedPrice,
  stationLabel,
  unitPriceOf,
  tableTone,
  CLOCK_KEY,
  COURSE_KEY,
} from "./posActions";
import "./waiterPos.css";

function resolveStorage(override, kind) {
  if (override) return override;
  if (process.env.NODE_ENV === "test" || typeof window === "undefined") return null;
  return kind === "session" ? window.sessionStorage : window.localStorage;
}

function pushDigit(current, digit) {
  if (current === "0") return digit === "0" ? "0" : digit;
  const next = Number(`${current}${digit}`);
  if (!Number.isInteger(next) || next > 20) return current;
  return String(next);
}

function Icon({ d }) {
  return (
    <svg className="pos-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  orders: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  tables: "M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z",
  plus: "M12 5v14M5 12h14",
  print: "M7 8V4h10v4M7 16H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z",
  kitchen: "M6 3v10a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V3M8 21h2M18 3v7M16 10h4M18 10v11",
  bar: "M8 3h8l-1 7a3 3 0 0 1-6 0L8 3zM7 21h10M9 14v7M15 14v7",
  void: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM7 12h10",
  discount: "M12 3l2.2 4.6L19 8.2l-3.5 3.4.8 4.9L12 14.8 7.7 16.5l.8-4.9L5 8.2l4.8-.6z",
  notes: "M7 3h8l4 4v14H7zM15 3v4h4M9 12h6M9 16h6",
  tags: "M4 12V5h7l9 9-7 7zM8.5 8.5h.01",
  more: "M6 12h.01M12 12h.01M18 12h.01",
};

const NAV = [
  { id: "home", label: "Home", icon: "home" },
  { id: "orders", label: "Orders", icon: "orders" },
  { id: "tables", label: "Tables", icon: "tables" },
  { id: "new", label: "New", icon: "plus" },
];

const ACTIONS = [
  { id: "kitchen", label: "Send to Kitchen", icon: "kitchen" },
  { id: "bar", label: "Send to Bar", icon: "bar" },
  { id: "print", label: "Print", icon: "print" },
  { id: "void", label: "Void", icon: "void" },
  { id: "discount", label: "Discount", icon: "discount" },
  { id: "notes", label: "Notes", icon: "notes" },
  { id: "tags", label: "Tags", icon: "tags" },
  { id: "more", label: "More", icon: "more" },
];

const TONE_WORD = { free: "Free", seated: "Seated", dining: "Dining", closed: "Closed" };

function Photo({ src, label }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="pos-photo-fallback" aria-hidden="true">{(label || "?").slice(0, 1)}</span>;
  return <img src={src} alt="" onError={() => setFailed(true)} />;
}

function Backdrop({ label, children, onClose }) {
  return (
    <div className="pos-backdrop" onMouseDown={onClose}>
      <div
        className="pos-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default function WaiterPos({ lines = null, storage = null, clockStorage = null, now = null, databaseMode = false }) {
  const catalogueLines = useMemo(() => lines || khobarCatalogueLines(), [lines]);
  const draftSeq = useRef(1);
  const sending = useRef(false);
  const revisionRef = useRef(0);
  const [devSession, setDevSession] = useState(null);
  const [restaurant, setRestaurant] = useState(() => {
    const menu = menuFromLines(lines || khobarCatalogueLines());
    if (databaseMode) return { state: emptyServiceState(), menu };
    const active = resolveStorage(storage, "local");
    let loaded = null;
    try {
      loaded = active ? loadServiceSnapshot(active, "khobar", { menu }) : null;
    } catch {
      loaded = null;
    }
    return loaded?.ok ? loaded.restaurant : openSimulatedService("khobar", { menu }).restaurant;
  });
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState("tables");
  const [zoneId, setZoneId] = useState(() => (
    restaurant.state.floors.find((floor) => floor.id === "indoor")?.id || restaurant.state.floors[0]?.id || ""
  ));
  const [pickedId, setPickedId] = useState(null);
  const [activeTableId, setActiveTableId] = useState(null);
  const [keypad, setKeypad] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [selectedKey, setSelectedKey] = useState(null);
  const [activeCourse, setActiveCourse] = useState(COURSES[0]);
  const [showCourses, setShowCourses] = useState(false);
  const [categoryId, setCategoryId] = useState(null);
  const [sectionId, setSectionId] = useState(null);
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [clock, setClock] = useState(() => now ?? Date.now());

  const localStore = resolveStorage(storage, "local");
  const clocks = resolveStorage(clockStorage, "session");

  useEffect(() => {
    if (now != null) {
      setClock(now);
      return undefined;
    }
    const timer = setInterval(() => setClock(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [now]);

  useEffect(() => {
    if (databaseMode || !localStore) return undefined;
    saveServiceSnapshot(localStore, restaurant);
    return undefined;
  }, [databaseMode, localStore, restaurant, frame]);

  useEffect(() => {
    if (!databaseMode || !devToken()) return undefined;
    let stop = false;
    devState().then((data) => {
      if (stop || !data?.state || !data.role) return;
      revisionRef.current = data.revision || data.state.revision || 0;
      setRestaurant((prev) => ({ ...prev, state: data.state }));
      setDevSession({ ok: true, role: data.role, email: data.email });
    });
    return () => {
      stop = true;
    };
  }, [databaseMode]);

  useEffect(() => {
    if (!databaseMode || !devSession) return undefined;
    let stop = false;
    async function pull() {
      const data = await devState();
      if (stop) return;
      if (!data?.state) {
        if (data?.reason === "sign_in_required") {
          setDevToken("");
          setDevSession(null);
        }
        return;
      }
      revisionRef.current = data.revision || data.state.revision || 0;
      setRestaurant((prev) => ({ ...prev, state: data.state }));
    }
    pull();
    const timer = setInterval(pull, 2000);
    const stopListen = devListen(() => pull());
    return () => {
      stop = true;
      clearInterval(timer);
      stopListen();
    };
  }, [databaseMode, devSession]);

  useEffect(() => {
    if (!databaseMode || typeof document === "undefined") return undefined;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/waiter.webmanifest";
    link.dataset.waiterManifest = "1";
    document.head.appendChild(link);
    return () => link.remove();
  }, [databaseMode]);

  useEffect(() => {
    if (typeof document !== "undefined") document.title = "NAC Waiter";
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key !== "Escape") return;
      setKeypad(null);
      setComposer(null);
      setSheet(null);
      setPickedId(null);
      setTicketOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const bump = () => setFrame((value) => value + 1);
  const state = restaurant.state;
  const groups = useMemo(() => groupCatalogue(catalogueLines), [catalogueLines]);
  const category = groups.find((row) => row.id === categoryId) || groups.find((row) => row.name === "Daytime") || groups[0] || null;
  const section = category?.sections.find((row) => row.id === sectionId) || null;
  const table = state.tables.find((row) => row.id === activeTableId) || null;
  const session = table ? openSessionForTable(state, table.id) : null;
  const order = session ? orderForSession(state, session.id) : null;
  const ticket = order ? ticketForOrder(state, order.id) : null;
  const reservation = session
    ? state.reservations.find((row) => row.id === session.reservationId) || reservationByTable(state, table?.id)
    : null;
  const staged = session ? (drafts[session.id] || []) : [];
  const covers = Number.isFinite(reservation?.partySize) ? reservation.partySize : null;
  const total = checkTotal(order?.items, staged);
  const courseMap = readMap(clocks, COURSE_KEY);
  const seatingMap = readMap(clocks, CLOCK_KEY);
  const needle = query.trim().toLowerCase();
  const results = needle
    ? catalogueLines.filter((line) => {
      if (line.available === false) return false;
      return [line.name, line.nameAr, line.sectionName, line.categoryName].join(" ").toLowerCase().includes(needle);
    }).slice(0, 48)
    : [];

  function openOrder(tableId) {
    setActiveTableId(tableId);
    setPickedId(null);
    setView("order");
    setTicketOpen(false);
    setQuery("");
  }

  async function finishOpen(tableId, partySize, name) {
    const at = now ?? Date.now();
    if (databaseMode) {
      const result = await openTableOnServer(restaurant.state, {
        tableId,
        partySize,
        guestName: name,
        now: new Date(at),
      });
      if (result.state) {
        revisionRef.current = result.revision ?? result.state.revision ?? revisionRef.current;
        setRestaurant((prev) => ({ ...prev, state: result.state }));
      }
      if (!result.ok) {
        setNotice(noticeFor(result.reason));
        return;
      }
      if (result.created && result.session) rememberSeating(clocks, result.session.id, at);
      setKeypad(null);
      openOrder(tableId);
      setNotice("");
      return;
    }
    const result = openTableOrder(restaurant, {
      tableId,
      partySize,
      guestName: name,
      now: new Date(at),
    });
    bump();
    if (!result.ok) {
      setNotice(noticeFor(result.reason));
      return;
    }
    if (result.created) rememberSeating(clocks, result.session.id, at);
    setKeypad(null);
    openOrder(tableId);
    setNotice("");
  }

  function chooseTable(seat) {
    if (seat.active === false || seat.removed) {
      setNotice("This table is not in service.");
      return;
    }
    setPickedId((current) => (current === seat.id ? null : seat.id));
  }

  function startFromTable(seat) {
    const existing = openSessionForTable(state, seat.id);
    if (existing) {
      openOrder(seat.id);
      return;
    }
    const seated = reservationByTable(state, seat.id);
    if (seated && seat.status === "assigned" && Number.isInteger(seated.partySize) && seated.partySize > 0) {
      finishOpen(seat.id, seated.partySize, guestName(state, seated.guestId));
      return;
    }
    setPickedId(null);
    setKeypad({ tableId: seat.id, digits: "0", name: "Walk-in" });
  }

  function selectedLine() {
    if (!selectedKey) return null;
    const [kind, id] = selectedKey.split(":");
    if (kind === "staged") {
      const line = staged.find((row) => row.localId === selectedKey.slice(7));
      return line ? { kind, line } : null;
    }
    const item = order?.items.find((row) => row.id === id);
    return item ? { kind: "sent", item } : null;
  }

  function addStaged(next, replaceId) {
    if (!session) return;
    setDrafts((prev) => {
      const current = prev[session.id] || [];
      const lines = replaceId
        ? current.map((row) => (row.localId === replaceId ? next : row))
        : [...current, next];
      return { ...prev, [session.id]: lines };
    });
    setSelectedKey(`staged:${next.localId}`);
    setComposer(null);
  }

  function commitComposer() {
    if (!composer || !session) return;
    const required = (composer.line.modifiers || []).filter((modifier) => modifier.required === true);
    const missing = required.filter((modifier) => !composer.modifierIds.includes(modifier.id));
    if (missing.length) {
      setNotice(`Choose ${missing[0].name}.`);
      return;
    }
    const priced = stagedPrice(composer.line, composer.modifierIds, composer.quantity);
    if (!priced) {
      setNotice("That add-on is not on this product.");
      return;
    }
    const station = resolveStation(composer.line);
    addStaged({
      localId: composer.localId || `draft-${draftSeq.current++}`,
      itemId: composer.line.itemId,
      name: composer.line.name,
      quantity: priced.quantity,
      modifiers: priced.modifiers,
      instructions: composer.instructions.trim().slice(0, 140),
      course: composer.course || activeCourse,
      price: priced.price,
      unitPrice: priced.price / priced.quantity,
      categorySlug: composer.line.categorySlug || null,
      station: station.station,
    }, composer.localId);
  }

  function editStaged(line) {
    const source = catalogueLines.find((row) => row.itemId === line.itemId);
    if (!source) {
      setNotice("That product is not on this menu.");
      return;
    }
    setComposer({
      line: source,
      quantity: line.quantity,
      modifierIds: line.modifiers.map((modifier) => modifier.id),
      instructions: line.instructions,
      course: line.course,
      localId: line.localId,
    });
  }

  function removeStaged(localId) {
    if (!session) return;
    setDrafts((prev) => ({
      ...prev,
      [session.id]: (prev[session.id] || []).filter((row) => row.localId !== localId),
    }));
    setSelectedKey(null);
    setNotice("Removed from the check.");
  }

  async function sendDestination(destination) {
    if (!session) {
      setNotice("Open a table before sending.");
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setSendBusy(true);
    setNotice("Sending to the kitchen…");
    if (databaseMode) {
      const kitchen = staged.filter((line) => resolveStation(line).station === "pass");
      const held = staged.filter((line) => resolveStation(line).station !== "pass");
      if (!kitchen.length) {
        sending.current = false;
        setSendBusy(false);
        setNotice(noticeFor(held.length ? "station_not_recorded" : "nothing_to_send"));
        return;
      }
      let latest = null;
      try {
      for (const line of kitchen) {
        latest = await devAct("addItem", [session.id, {
          itemId: line.itemId,
          quantity: line.quantity,
          modifierIds: (line.modifiers || []).map((modifier) => modifier.id),
          instructions: line.instructions || "",
          clientKey: line.localId,
        }], revisionRef.current);
        if (!latest?.ok) break;
        revisionRef.current = latest.revision ?? revisionRef.current;
      }
      } catch {
        latest = { ok: false, reason: "service_unavailable" };
      } finally {
      sending.current = false;
      setSendBusy(false);
      }
      if (latest?.state) setRestaurant((prev) => ({ ...prev, state: latest.state }));
      if (!latest?.ok) {
        setNotice(noticeFor(latest?.reason));
        return;
      }
      const sentLocal = new Set(kitchen.map((line) => line.localId));
      setDrafts((prev) => ({
        ...prev,
        [session.id]: (prev[session.id] || []).filter((line) => !sentLocal.has(line.localId)),
      }));
      setSelectedKey(null);
      setNotice(held.some((line) => resolveStation(line).station === "bar")
        ? "Sent to the kitchen. Drinks stayed on the check."
        : "Sent to the kitchen.");
      return;
    }
    const result = sendToStation(restaurant, session.id, staged, destination);
    sending.current = false;
    setSendBusy(false);
    if (result.sent?.length) {
      const kitchen = staged.filter((line) => resolveStation(line).station === "pass");
      const sentLocal = new Set(kitchen.slice(0, result.sent.length).map((line) => line.localId));
      setDrafts((prev) => ({
        ...prev,
        [session.id]: (prev[session.id] || []).filter((line) => !sentLocal.has(line.localId)),
      }));
      rememberCourses(clocks, result.sent.map((row) => ({ id: row.item.id, course: row.course })));
      setSelectedKey(null);
    }
    if (!result.ok) {
      setNotice(noticeFor(result.reason));
      bump();
      return;
    }
    const heldDrinks = (result.held || []).some((line) => line.station === "bar");
    setNotice(heldDrinks ? "Sent to the kitchen. Drinks stayed on the check." : "Sent to the kitchen.");
    bump();
  }

  function voidSelection() {
    const current = selectedLine();
    if (!current) {
      setSheet({
        title: "Void",
        text: "Select an item first. Sent items cannot be voided from this terminal.",
        tone: "unavailable",
      });
      return;
    }
    if (current.kind === "staged" && session) {
      setDrafts((prev) => ({
        ...prev,
        [session.id]: (prev[session.id] || []).filter((row) => row.localId !== current.line.localId),
      }));
      setSelectedKey(null);
      setNotice("Removed from the check.");
      return;
    }
    setSheet({
      title: "Void",
      text: "Sent items cannot be voided from this terminal.",
      tone: "unavailable",
    });
  }

  function noteSelection() {
    const current = selectedLine();
    if (!current) {
      setSheet({ title: "Notes", text: "Select an item to add a note.", tone: "unavailable" });
      return;
    }
    if (current.kind === "staged") {
      const line = catalogueLines.find((row) => row.itemId === current.line.itemId);
      if (!line) return;
      setComposer({
        line,
        quantity: current.line.quantity,
        modifierIds: current.line.modifiers.map((modifier) => modifier.id),
        instructions: current.line.instructions,
        course: current.line.course,
        localId: current.line.localId,
      });
      return;
    }
    setSheet({
      title: "Notes",
      text: current.item.instructions
        ? `Sent note: ${current.item.instructions}`
        : "Notes on sent items stay as they were sent.",
      tone: "unavailable",
    });
  }

  function onAction(id) {
    if (id === "kitchen") {
      sendDestination("kitchen");
      return;
    }
    if (id === "bar") {
      sendDestination("bar");
      return;
    }
    if (id === "void") {
      voidSelection();
      return;
    }
    if (id === "notes") {
      noteSelection();
      return;
    }
    if (id === "print") {
      setSheet({ title: "Print", text: "Printer is not connected. Nothing was printed.", tone: "unavailable" });
      return;
    }
    if (id === "discount") {
      discountAttempt(restaurant);
      setSheet({ title: "Discount", text: "Discounts cannot be applied from this terminal. The total is unchanged.", tone: "unavailable" });
      return;
    }
    if (id === "tags") {
      setSheet({ title: "Tags", text: "Tags are unavailable.", tone: "unavailable" });
      return;
    }
    if (id === "more") {
      setSheet({ title: "More", tone: "menu" });
    }
  }

  async function requestBill() {
    if (!databaseMode || !session) return;
    const result = await devAct("openBill", session.id, revisionRef.current);
    if (result?.state) {
      revisionRef.current = result.revision ?? revisionRef.current;
      setRestaurant((prev) => ({ ...prev, state: result.state }));
    }
    setSheet(null);
    setNotice(result?.ok ? "Bill requested. The cashier opens it. No payment was captured." : noticeFor(result?.reason));
  }

  async function serveOrder() {
    if (!order) return;
    if (databaseMode) {
      const result = await devAct("markServed", order.id, revisionRef.current);
      if (result?.state) {
        revisionRef.current = result.revision ?? revisionRef.current;
        setRestaurant((prev) => ({ ...prev, state: result.state }));
      }
      setSheet(null);
      setNotice(result?.ok ? "Marked served." : noticeFor(result?.reason));
      return;
    }
    const result = markOrderServed(restaurant, order.id);
    bump();
    setSheet(null);
    setNotice(result.ok ? "Marked served." : noticeFor(result.reason));
  }

  function openProduct(line) {
    if (!session) return;
    setComposer({
      line,
      quantity: 1,
      modifierIds: [],
      instructions: "",
      course: activeCourse,
      localId: null,
    });
  }

  const openChecks = state.sessions.filter((row) => row.status === "open").map((row) => {
    const seat = state.tables.find((tableRow) => tableRow.id === row.tableId);
    const checkOrder = orderForSession(state, row.id);
    const checkTicket = checkOrder ? ticketForOrder(state, checkOrder.id) : null;
    const checkReservation = state.reservations.find((item) => item.id === row.reservationId);
    return { session: row, seat, order: checkOrder, ticket: checkTicket, reservation: checkReservation };
  });

  const picked = state.tables.find((row) => row.id === pickedId) || null;
  const pickedSession = picked ? openSessionForTable(state, picked.id) : null;
  const statusWord = !ticket || ticket.status === "queued" ? "ACTIVE" : kitchenLabel(ticket).toUpperCase();

  if (databaseMode && !devSession) {
    return (
      <form
        className="pos pos-gate"
        data-testid="waiter-pos"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const email = String(data.get("staff") || "");
          const password = String(data.get("password") || "");
          setSigningIn(true);
          let result = null;
          try {
            result = await devLogin(email, password, email.split(".")[0]);
          } finally {
            setSigningIn(false);
          }
          if (!result?.ok) {
            setNotice(noticeFor(result?.reason || "sign_in_failed"));
            return;
          }
          setDevToken(result.token);
          setDevSession(result);
          setNotice("Signed in to the local development database.");
        }}
      >
        <h1>NAC Waiter</h1>
        <p>Synthetic staff only. This password is not a production credential.</p>
        {notice ? <p role="status">{notice}</p> : null}
        <label>
          Staff
          <select name="staff" aria-label="Development staff" defaultValue="waiter.khobar@nac.test">
            <option value="waiter.khobar@nac.test">Waiter Khobar</option>
            <option value="host.khobar@nac.test">Host Khobar</option>
            <option value="kitchen.khobar@nac.test">Kitchen Khobar</option>
            <option value="cashier.khobar@nac.test">Cashier Khobar</option>
          </select>
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" />
        </label>
        <button type="submit" className="pos-primary" disabled={signingIn} aria-busy={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button>
      </form>
    );
  }

  return (
    <div
      className="pos"
      data-testid="waiter-pos"
      data-revision={state.revision}
      data-sessions={state.sessions.filter((row) => row.status === "open").length}
      data-session={session?.id || ""}
      data-order={order?.id || ""}
      data-ticket={ticket?.id || ""}
    >
      {notice ? <p className="pos-notice" role="status">{notice}</p> : null}
      <div className="pos-body">
        {view === "home" && (
          <section className="pos-home" aria-label="Home">
            <p className="pos-brand">NAC</p>
            <h1>Khobar</h1>
            <p className="pos-quiet">{openChecks.length === 0 ? "No open tables." : `${openChecks.length} open ${openChecks.length === 1 ? "table" : "tables"}.`}</p>
            {openChecks.filter((check) => check.seat).map((check) => (
              <button key={check.session.id} type="button" className="pos-check" onClick={() => openOrder(check.seat.id)}>
                <span>
                  <b>Table {check.seat.label}</b>
                  <small>{guestName(state, check.session.guestId)} · {kitchenLabel(check.ticket)}</small>
                </span>
                <span>{posMoney(checkTotal(check.order?.items, []))}</span>
              </button>
            ))}
          </section>
        )}

        {view === "orders" && (
          <section className="pos-orders" aria-label="Orders">
            <h1>Orders</h1>
            {openChecks.length === 0 && <p className="pos-quiet">No open orders.</p>}
            {openChecks.filter((check) => check.seat).map((check) => (
              <button key={check.session.id} type="button" className="pos-check" onClick={() => openOrder(check.seat.id)}>
                <span>
                  <b>Table {check.seat.label}</b>
                  <small>
                    {guestName(state, check.session.guestId)}
                    {" · "}
                    {check.order?.items.length || 0} sent
                    {" · "}
                    {kitchenLabel(check.ticket)}
                  </small>
                </span>
                <span>{posMoney(checkTotal(check.order?.items, []))}</span>
              </button>
            ))}
          </section>
        )}

        {view === "tables" && (
          <section className="pos-tables" aria-label="Tables">
            <header className="pos-topbar">
              <button type="button" className="pos-text" onClick={() => setView("home")}>Back</button>
              <h1>Tables</h1>
              {databaseMode ? (
                <button type="button" className="pos-text" onClick={async () => {
                  await devLogout();
                  setDevToken("");
                  setDevSession(null);
                  setRestaurant((prev) => ({ ...prev, state: emptyServiceState() }));
                }}>Sign out</button>
              ) : <span />}
            </header>
            <div className="pos-floor" data-zone={zoneId}>
              {placeTables(state.tables.filter((row) => row.floorId === zoneId && row.active !== false && !row.removed)).map(({ table: seat, left, top }) => {
                const tone = tableTone(seat.status);
                const seated = reservationByTable(state, seat.id);
                const openSeat = openSessionForTable(state, seat.id);
                const guest = seated ? guestName(state, seated.guestId) : "";
                const elapsed = openSeat ? elapsedLabel(seatingMap[openSeat.id], clock) : null;
                const timeText = tone === "dining" ? (elapsed || "Time not recorded") : "";
                const label = [`Table ${seat.label}`, TONE_WORD[tone], seatCaption(seat), guest, timeText].filter(Boolean).join(", ");
                return (
                  <button
                    key={seat.id}
                    type="button"
                    className="pos-table"
                    style={{ left: `${left}%`, top: `${top}%` }}
                    data-tone={tone}
                    data-table={seat.id}
                    aria-pressed={pickedId === seat.id}
                    aria-label={label}
                    onClick={() => chooseTable(seat)}
                  >
                    <strong>Table {seat.label}</strong>
                    <span className="pos-tone">{TONE_WORD[tone]}</span>
                    {guest ? <em>{guest}</em> : <em />}
                    <small>{timeText || seatCaption(seat)}</small>
                  </button>
                );
              })}
              {state.tables.filter((row) => row.floorId === zoneId && row.active !== false && !row.removed).length === 0 && (
                <p className="pos-empty">No tables in this area.</p>
              )}
              {picked && (
                <div className="pos-float">
                  <button type="button" onClick={() => startFromTable(picked)}>
                    {pickedSession ? "Open order" : "Start order"}
                  </button>
                </div>
              )}
            </div>
            <div className="pos-areas" role="tablist" aria-label="Areas">
              {state.floors.map((floor) => (
                <button
                  key={floor.id}
                  type="button"
                  role="tab"
                  aria-selected={zoneId === floor.id}
                  onClick={() => { setZoneId(floor.id); setPickedId(null); }}
                >
                  {floor.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {view === "order" && (
          <section className="pos-order" aria-label="Order" data-testid="pos-order">
            {!session && (
              <div className="pos-home">
                <h1>No open order</h1>
                <button type="button" className="pos-primary" onClick={() => setView("tables")}>Choose a table</button>
              </div>
            )}
            {session && (
              <>
                <button type="button" className="pos-checkbar" onClick={() => setTicketOpen(true)}>
                  <span>Table {table.label}</span>
                  <span>{posMoney(total)}</span>
                </button>
                <div className="pos-order-grid">
                  <aside className={`pos-ticket${ticketOpen ? " is-open" : ""}`} aria-label="Check">
                    <div className="pos-ticket-top">
                      <span className="pos-covers">{covers == null ? "—" : covers}</span>
                      <span className="pos-active">{order?.items?.length ? statusWord : "ACTIVE"}</span>
                      {ticketOpen && (
                        <button type="button" className="pos-text" onClick={() => setTicketOpen(false)}>Close</button>
                      )}
                    </div>
                    <div className="pos-dine">
                      <p>
                        <strong>Dine in (Table {table.label})</strong>
                      </p>
                      <button
                        type="button"
                        className="pos-guest"
                        onClick={() => setSheet({
                          title: "Guest",
                          text: `${guestName(state, session.guestId)} is already seated. The name cannot be changed from this terminal.`,
                          tone: "unavailable",
                        })}
                      >
                        {guestName(state, session.guestId)}
                      </button>
                    </div>
                    <ul className="pos-lines">
                      {staged.map((line) => (
                        <li key={line.localId} className="pos-line-row">
                          <button
                            type="button"
                            className="pos-line"
                            aria-pressed={selectedKey === `staged:${line.localId}`}
                            onClick={() => setSelectedKey(`staged:${line.localId}`)}
                          >
                            <span>
                              <b>{line.quantity} × {line.name}</b>
                              <small>{posMoney(unitPriceOf(line))} each</small>
                              {line.modifiers.map((modifier) => <small key={modifier.id}>+ {modifier.name}</small>)}
                              {line.instructions ? <small>{line.instructions}</small> : null}
                              <span className="pos-course-pill">{line.course}</span>
                              <span className="pos-unsent">{stationLabel(line.station)} · Not sent</span>
                            </span>
                            <span className="pos-price">{posMoney(line.price)}</span>
                          </button>
                          <span className="pos-line-edit">
                            <button type="button" aria-label={`Edit ${line.name}`} onClick={() => editStaged(line)}>Edit</button>
                            <button type="button" aria-label={`Remove ${line.name}`} onClick={() => removeStaged(line.localId)}>Remove</button>
                          </span>
                        </li>
                      ))}
                      {(order?.items || []).map((item) => (
                        <li key={item.id} className="pos-line-row">
                          <button
                            type="button"
                            className="pos-line"
                            aria-pressed={selectedKey === `sent:${item.id}`}
                            onClick={() => setSelectedKey(`sent:${item.id}`)}
                          >
                            <span>
                              <b>{item.quantity} × {item.name}</b>
                              <small>{posMoney(unitPriceOf(item))} each</small>
                              {item.modifiers.map((modifier) => <small key={modifier.id}>+ {modifier.name}</small>)}
                              {item.instructions ? <small>{item.instructions}</small> : null}
                              {courseMap[item.id] ? <span className="pos-course-pill">{courseMap[item.id]}</span> : null}
                              <span className="pos-sent">{stationLabel(item.station)} · {kitchenLabel(ticket, item.status)}</span>
                            </span>
                            <span className="pos-price">{posMoney(item.price)}</span>
                          </button>
                        </li>
                      ))}
                      {staged.length === 0 && (order?.items.length || 0) === 0 && (
                        <li className="pos-quiet" style={{ padding: "12px 4px" }}>No items yet.</li>
                      )}
                    </ul>
                    <div className="pos-course-row">
                      <button type="button" onClick={() => setShowCourses((value) => !value)}>Add course</button>
                      {showCourses && COURSES.map((course) => (
                        <button
                          key={course}
                          type="button"
                          className="pos-chip"
                          aria-pressed={activeCourse === course}
                          onClick={() => {
                            setActiveCourse(course);
                            if (selectedKey?.startsWith("staged:") && session) {
                              const localId = selectedKey.slice(7);
                              setDrafts((prev) => ({
                                ...prev,
                                [session.id]: (prev[session.id] || []).map((row) => (
                                  row.localId === localId ? { ...row, course } : row
                                )),
                              }));
                            }
                          }}
                        >
                          {course}
                        </button>
                      ))}
                    </div>
                    <div className="pos-tax-row">
                      <span>Subtotal</span>
                      <span>{posMoney(total)}</span>
                    </div>
                    <div className="pos-tax-row">
                      <span>Tax</span>
                      <span>Not on this check</span>
                    </div>
                    <div className="pos-grand" data-testid="pos-total">
                      <span>Total</span>
                      <span>{posMoney(total)}</span>
                    </div>
                  </aside>
                  <div className="pos-menu">
                    <div className="pos-actions" aria-label="Order actions">
                      {ACTIONS.map((action) => (
                        <button key={action.id} type="button" className="pos-action" disabled={sendBusy} aria-busy={sendBusy} onClick={() => onAction(action.id)}>
                          <Icon d={ICONS[action.icon]} />
                          {action.label}
                        </button>
                      ))}
                    </div>
                    <form className="pos-search" role="search" onSubmit={(event) => event.preventDefault()}>
                      <label>
                        <span className="pos-sr">Search products</span>
                        <input
                          value={query}
                          placeholder="Search products"
                          autoComplete="off"
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                    </form>
                    <div className="pos-cats" aria-label="Menu categories">
                      {groups.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          aria-pressed={category?.id === row.id}
                          onClick={() => { setCategoryId(row.id); setSectionId(null); setQuery(""); }}
                        >
                          {row.name}
                        </button>
                      ))}
                    </div>
                    <div className="pos-menu-scroll">
                      {needle ? (
                        <div className="pos-tiles">
                          {results.length === 0 && <p className="pos-quiet">No matching products.</p>}
                          {results.map((line) => (
                            <ProductButton key={line.itemId} line={line} onOpen={openProduct} />
                          ))}
                        </div>
                      ) : section ? (
                        <>
                          <button type="button" className="pos-back" onClick={() => setSectionId(null)}>
                            {category.name}
                          </button>
                          <div className="pos-tiles" style={{ marginTop: 10 }}>
                            {section.items.map((line) => (
                              <ProductButton key={line.itemId} line={line} onOpen={openProduct} />
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="pos-tiles">
                          {(category?.sections || []).map((row) => (
                            <button key={row.id} type="button" className="pos-tile" onClick={() => setSectionId(row.id)}>
                              <Photo src={row.image} label={row.name} />
                              <b>{row.name}</b>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      <nav className="pos-nav" aria-label="Waiter">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => {
              if (item.id === "new") {
                setView("tables");
                setPickedId(null);
                setNotice("Choose a free table.");
                return;
              }
              setView(item.id);
              setNotice("");
            }}
          >
            <Icon d={ICONS[item.icon]} />
            {item.label}
          </button>
        ))}
      </nav>

      {keypad && (
        <div className="pos-backdrop" onMouseDown={() => setKeypad(null)}>
          <div
            className="pos-keypad"
            role="dialog"
            aria-modal="true"
            aria-label="Number of guests"
            data-testid="guest-keypad"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>Number of guests</h2>
            <p className="pos-count">{keypad.digits}</p>
            <div className="pos-keys">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", ""].map((key) => (
                key ? (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setKeypad((current) => ({
                      ...current,
                      digits: key === "C" ? "0" : pushDigit(current.digits, key),
                    }))}
                  >
                    {key}
                  </button>
                ) : <span key="blank" />
              ))}
            </div>
            <label className="pos-name">
              Guest name
              <input
                value={keypad.name}
                onChange={(event) => setKeypad((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <div className="pos-key-actions">
              <button type="button" className="pos-cancel" onClick={() => setKeypad(null)}>Cancel</button>
              <button
                type="button"
                disabled={keypad.digits === "0"}
                onClick={() => finishOpen(keypad.tableId, Number(keypad.digits), keypad.name)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {composer && (
        <Backdrop label={composer.line.name} onClose={() => setComposer(null)}>
          <div>
            <h2>{composer.line.name}</h2>
            {composer.line.description ? <p className="pos-quiet">{composer.line.description}</p> : null}
            <p className="pos-quiet" style={{ textAlign: "center" }}>{posMoney(stagedPrice(composer.line, composer.modifierIds, composer.quantity)?.price)}</p>
            {composer.line.modifiers.length > 0 && (
              <fieldset className="pos-mods">
                <legend>{composer.line.modifiers.some((modifier) => modifier.required) ? "Required" : "Add-ons"}</legend>
                {composer.line.modifiers.map((modifier) => {
                  const on = composer.modifierIds.includes(modifier.id);
                  return (
                    <button
                      key={modifier.id}
                      type="button"
                      className="pos-chip"
                      aria-pressed={on}
                      onClick={() => setComposer((current) => ({
                        ...current,
                        modifierIds: on
                          ? current.modifierIds.filter((id) => id !== modifier.id)
                          : [...current.modifierIds, modifier.id],
                      }))}
                    >
                      {modifier.name} · {posMoney(modifier.price)}
                    </button>
                  );
                })}
              </fieldset>
            )}
            <div className="pos-step" aria-label="Quantity">
              <button type="button" aria-label="Decrease quantity" onClick={() => setComposer((current) => ({ ...current, quantity: Math.max(1, current.quantity - 1) }))}>−</button>
              <strong>{composer.quantity}</strong>
              <button type="button" aria-label="Increase quantity" onClick={() => setComposer((current) => ({ ...current, quantity: Math.min(99, current.quantity + 1) }))}>+</button>
            </div>
            <label className="pos-name">
              Item note
              <textarea
                rows={2}
                maxLength={140}
                value={composer.instructions}
                onChange={(event) => setComposer((current) => ({ ...current, instructions: event.target.value }))}
              />
            </label>
            <div className="pos-course-row">
              {COURSES.map((course) => (
                <button
                  key={course}
                  type="button"
                  className="pos-chip"
                  aria-pressed={composer.course === course}
                  onClick={() => setComposer((current) => ({ ...current, course }))}
                >
                  {course}
                </button>
              ))}
            </div>
            <div className="pos-composer-actions">
              <button type="button" className="pos-cancel" onClick={() => setComposer(null)}>Cancel</button>
              <button type="button" onClick={commitComposer}>{composer.localId ? "Update item" : "Add to order"}</button>
            </div>
          </div>
        </Backdrop>
      )}

      {sheet && (
        <Backdrop label={sheet.title} onClose={() => setSheet(null)}>
          {sheet.tone === "unavailable" && <p className="pos-unavailable">Unavailable</p>}
          <h2>{sheet.title}</h2>
          {sheet.text ? <p>{sheet.text}</p> : null}
          {sheet.tone === "menu" && (
            <>
              <p className="pos-quiet">Payment is taken at the cashier.</p>
              <button type="button" className="pos-primary" onClick={serveOrder} disabled={ticket?.status !== "ready"}>
                Mark served
              </button>
              {databaseMode && (
                <button type="button" onClick={requestBill} disabled={!session}>Request bill</button>
              )}
              {ticket?.status !== "ready" && <p className="pos-quiet">The kitchen marks the ticket ready before it can be served.</p>}
            </>
          )}
          <div className="pos-sheet-actions pos-close-only">
            <button type="button" onClick={() => setSheet(null)}>Close</button>
          </div>
        </Backdrop>
      )}
    </div>
  );
}

function ProductButton({ line, onOpen }) {
  return (
    <button type="button" className="pos-product" onClick={() => onOpen(line)}>
      <Photo src={line.image} label={line.name} />
      <b>{line.name}</b>
      <small>{line.portionLabel || posMoney(line.price)}</small>
    </button>
  );
}
