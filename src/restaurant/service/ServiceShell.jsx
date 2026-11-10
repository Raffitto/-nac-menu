import React, { useEffect, useRef, useState } from "react";
import { assertSingleServiceIdentity, openSimulatedService, operationalStatus, performServiceAction, serviceSummary } from "../contracts";
import { loadServiceSnapshot, saveServiceSnapshot } from "../model";
import CashierWorkspace from "./CashierWorkspace";
import ManagerDashboard from "./ManagerDashboard";
import HostWorkspace from "./HostWorkspace";
import KitchenWorkspace from "./KitchenWorkspace";
import WaiterWorkspace from "./WaiterWorkspace";
import {
  BRANCHES,
  buildOrderMenu,
  emptyScreen,
  reasonText,
} from "./serviceShared";
import { loadLayoutDocument, saveLayoutDocument } from "./layoutDocument";
import LayoutEditor from "./LayoutEditor";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { devAct, devJson, devListen, devLogin, devState, devToken, setDevToken, setRestaurantBranch } from "../devApi/client";
import { createRestaurantSync, restaurantSyncIntervalMs } from "../devApi/sync";
import { usesHostedRestaurantAuth } from "../devApi/endpoint";
import "./service.css";

const ROLES = [
  { id: "host", label: "Host", hint: "Book guests, seat tables, and keep the door list." },
  { id: "waiter", label: "Waiter", hint: "Open the table, send the order, and mark food served." },
  { id: "kitchen", label: "Kitchen", hint: "Move the ticket from new to ready." },
  { id: "cashier", label: "Cashier", hint: "Open the bill and close the table. A payment is not captured." },
  { id: "manager", label: "Manager", hint: "Publish the floor. Occupied tables stay in service. Payments are not captured." },
];

function developmentStorage(override) {
  if (override) return override;
  if (process.env.NODE_ENV === "test" || typeof window === "undefined") return null;
  return window.localStorage;
}

function emptyDbState() {
  return {
    developmentDatabase: true,
    branchId: "khobar",
    revision: 0,
    floors: [],
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
    layouts: [],
  };
}

export default function ServiceShell({
  catalogue = null,
  menu = null,
  menuForBranch = null,
  now = null,
  storage = null,
  liveClock = process.env.NODE_ENV !== "test",
  databaseMode = false,
}) {
  const [branchId, setBranchId] = useState("khobar");
  const [restaurant, setRestaurant] = useState(() => {
    if (databaseMode) return { state: emptyDbState(), menu };
    const active = developmentStorage(storage);
    const loaded = active ? loadServiceSnapshot(active, "khobar", { menu }) : null;
    return loaded?.ok ? loaded.restaurant : openSimulatedService("khobar", { menu }).restaurant;
  });
  const [role, setRole] = useState("host");
  const [screen, setScreen] = useState(emptyScreen);
  const [banner, setBanner] = useState(() => databaseMode ? "Local development database. Not production." : operationalStatus(restaurant.state));
  const [revision, setRevision] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => now ?? Date.now());
  const [access, setAccess] = useState("host");
  const [editing, setEditing] = useState(false);
  const [devEmail, setDevEmail] = useState("host.khobar@nac.test");
  const [devPassword, setDevPassword] = useState("");
  const [devSession, setDevSession] = useState(null);
  const [pilotClosed, setPilotClosed] = useState(false);
  const [serviceLoaded, setServiceLoaded] = useState(false);
  const hostedAuth = usesHostedRestaurantAuth();
  const revisionRef = useRef(0);
  const layoutStorage = developmentStorage(storage);
  const [layoutDoc, setLayoutDoc] = useState(() => loadLayoutDocument(layoutStorage));

  useEffect(() => {
    if (now != null) {
      setCurrentTime(now);
      return undefined;
    }
    if (!liveClock) return undefined;
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [now, liveClock]);

  useEffect(() => {
    setScreen((prev) => {
      let changed = false;
      const clocks = { ...prev.clocks };
      for (const ticket of restaurant.state.tickets) {
        const current = clocks[ticket.id];
        if (!current || current.status !== ticket.status) {
          clocks[ticket.id] = { status: ticket.status, since: Date.now() };
          changed = true;
        }
      }
      return changed ? { ...prev, clocks } : prev;
    });
  }, [restaurant, revision]);

  const orderMenu = buildOrderMenu(catalogue, restaurant.menu);
  const consumption = restaurant.state.orders.flatMap((order) => (
    order.items.map(() => ({ postsStock: false, writes: 0 }))
  ));
  const serviceRead = null;
  const canEditFloor = databaseMode
    ? ["manager", "administrator"].includes(devSession?.role)
    : role === "manager" || access === "manager";
  const identity = assertSingleServiceIdentity(restaurant.state);
  const summary = serviceSummary(restaurant.state);
  const branch = BRANCHES.find((row) => row.id === branchId);

  function dispatch(action, payload, success) {
    if (databaseMode) {
      return devAct(action, payload, revisionRef.current).then((result) => {
        if (result?.state) {
          revisionRef.current = result.revision ?? result.state.revision ?? revisionRef.current;
          setRestaurant((prev) => ({ ...prev, state: result.state, menu: prev.menu }));
          setRevision(revisionRef.current);
        }
        setBanner(result?.ok ? (success || "Saved in the local development database.") : reasonText(result?.reason));
        return result;
      });
    }
    const revision = restaurant.state.revision;
    const args = Array.isArray(payload) ? [...payload, revision] : [payload, revision];
    const result = performServiceAction(restaurant, role, action, args);
    setBanner(result.ok ? (success || "Saved in this simulation only.") : reasonText(result.reason));
    setRevision((value) => value + 1);
    return result;
  }

  function report(message) {
    setBanner(message);
  }

  useEffect(() => {
    if (databaseMode) return undefined;
    const active = developmentStorage(storage);
    if (!active) return undefined;
    saveServiceSnapshot(active, restaurant);
    return undefined;
  }, [restaurant, revision, storage, databaseMode]);

  useEffect(() => {
    if (!databaseMode || (!hostedAuth && !devToken())) return undefined;
    let stop = false;
    devState().then((data) => {
      if (stop) return;
      if (data?.reason === "service_unavailable") {
        setBanner("The restaurant service did not respond. Counts are not shown.");
        return;
      }
      if (data?.reason === "pilot_disabled") {
        setPilotClosed(true);
        setDevSession(null);
        return;
      }
      if (!data?.state || !data.role) return;
      setServiceLoaded(true);
      if (data.state.branchId) setRestaurantBranch(data.state.branchId);
      revisionRef.current = data.revision || data.state.revision || 0;
      setRestaurant((prev) => ({ ...prev, state: data.state, menu: prev.menu }));
      setRevision(revisionRef.current);
      setDevSession({ ok: true, role: data.role, branchId: data.state.branchId, email: data.email });
      setRole(data.role);
      if (data.state.branchId) setBranchId(data.state.branchId);
    });
    return () => {
      stop = true;
    };
  }, [databaseMode, hostedAuth]);

  useEffect(() => {
    if (!databaseMode || !devSession) return undefined;
    let stop = false;
    const sync = createRestaurantSync({
      isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
      pull: async () => {
        const started = Date.now();
        const data = await devState(revisionRef.current || undefined);
        if (stop) return;
        if (data?.reason === "service_unavailable") {
          setBanner("The restaurant service did not respond. Shown figures were not changed.");
          return;
        }
        if (data?.reason === "pilot_disabled") {
          setPilotClosed(true);
          setDevSession(null);
          return;
        }
        if (data?.unchanged) {
          revisionRef.current = data.revision;
          return;
        }
        if (!data?.state) return;
        setServiceLoaded(true);
        setBanner((current) => (
          String(current).startsWith("The restaurant service did not respond")
            ? "Connected to the local development database."
            : current
        ));
        revisionRef.current = data.revision || data.state.revision || 0;
        setRestaurant((prev) => ({ ...prev, state: data.state, menu: prev.menu }));
        setRevision(revisionRef.current);
        if (typeof document !== "undefined") {
          document.documentElement.dataset.restaurantSyncMs = String(Date.now() - started);
        }
      },
    });
    sync.request(true);
    const timer = setInterval(() => sync.request(false), restaurantSyncIntervalMs(role));
    const stopListen = devListen(() => sync.request(true));
    function onVisible() {
      if (document.visibilityState === "visible") sync.request(true);
    }
    function onOnline() {
      sync.request(true);
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      stop = true;
      clearInterval(timer);
      stopListen();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [databaseMode, devSession, role]);

  useEffect(() => {
    if (!databaseMode || editing) return undefined;
    const published = (restaurant.state.layouts || []).find((row) => row.status === "published" && row.document?.layouts);
    if (published?.document) setLayoutDoc(published.document);
    return undefined;
  }, [databaseMode, editing, restaurant.state.layouts]);

  function switchBranch(next) {
    const nextMenu = menuForBranch ? menuForBranch(next) : menu;
    const active = developmentStorage(storage);
    const loaded = active ? loadServiceSnapshot(active, next, { menu: nextMenu }) : null;
    const opened = loaded?.ok ? loaded : openSimulatedService(next, { menu: nextMenu });
    if (!opened.ok) {
      setBanner(reasonText(opened.reason));
      return;
    }
    setRestaurant(opened.restaurant);
    setScreen(emptyScreen());
    setEditing(false);
    setBranchId(next);
    setRole("host");
    setRevision((value) => value + 1);
    const label = BRANCHES.find((row) => row.id === next).label;
    const restored = opened.restaurant.state.reservations.length > 0
      || opened.restaurant.state.sessions.length > 0
      || opened.restaurant.state.visits.length > 0;
    setBanner(restored
      ? operationalStatus(opened.restaurant.state)
      : `${label} simulation is empty. Nothing was written.`);
  }

  async function registerPasskey() {
    try {
      const options = await devJson("/passkey/register/options", {});
      if (options.ok === false) {
        setBanner(reasonText(options.reason));
        return;
      }
      const credential = await startRegistration({ optionsJSON: options });
      const saved = await devJson("/passkey/register/verify", { response: credential });
      setBanner(saved.ok ? "Passkey registered for this device. Only the public key was stored." : reasonText(saved.reason));
    } catch {
      setBanner("Passkey registration was cancelled or this browser could not create one.");
    }
  }

  async function loginWithPasskey() {
    try {
      const options = await devJson("/passkey/login/options", { email: devEmail });
      if (!options.challenge) {
        setBanner(reasonText(options.reason || "passkey_not_registered"));
        return;
      }
      const credential = await startAuthentication({ optionsJSON: options });
      const result = await devJson("/passkey/login/verify", {
        email: devEmail,
        role: devEmail.startsWith("host.riyadh") ? "host" : devEmail.split(".")[0],
        response: credential,
      });
      if (!result?.ok) {
        setBanner(reasonText(result?.reason || "sign_in_failed"));
        return;
      }
      setDevToken(result.token);
      setDevSession(result);
      setRole(result.role);
      setBranchId(result.branchId);
      setBanner("Signed in with a passkey. No biometric template was stored.");
    } catch {
      setBanner("Passkey sign-in was cancelled or this browser has no passkey for that staff member.");
    }
  }

  async function chooseRole(next) {
    if (hostedAuth) {
      setBanner("The restaurant role comes from the NAC staff grant.");
      return;
    }
    if (!databaseMode) {
      setRole(next);
      if (next !== "host") setEditing(false);
      return;
    }
    const email = `${next}.${branchId}@nac.test`;
    const result = await devLogin(email, devPassword, next);
    if (!result?.ok) {
      setBanner(reasonText(result?.reason || "sign_in_failed"));
      return;
    }
    setDevToken(result.token);
    setDevSession(result);
    setRole(next);
    setBranchId(result.branchId);
    if (next !== "host") setEditing(false);
  }

  const shared = {
    restaurant,
    role,
    dispatch,
    report,
    screen,
    setScreen,
    menu: orderMenu,
    currentTime,
    onRole: setRole,
    layoutStorage,
    layoutDoc,
    onEditFloor: canEditFloor && !editing ? () => setEditing(true) : null,
  };

  if (pilotClosed) {
    return (
      <main data-testid="pilot-closed" style={{ minHeight: "100vh", background: "#0a0908", color: "#f9f9f7", fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <p>TEST MODE — NOT LIVE RESTAURANT OPERATIONS</p>
        <h1>Restaurant Pilot Mode is off</h1>
        <p>This session is closed. Guest ordering and guest payments stay off.</p>
      </main>
    );
  }

  return (
    <div className={`svc${role === "host" && !editing ? " svc-live" : ""}`} data-testid="restaurant-sim" data-branch={branchId} data-revision={revision} data-role={role}>
      <header className="svc-header">
        <div className="svc-brand">
          <p className="svc-kicker">NAC</p>
          <h1>{branch ? branch.label : "Branch unavailable"}</h1>
        </div>
        <label>
          Branch
          <select value={branchId} onChange={(event) => switchBranch(event.target.value)}>
            {BRANCHES.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
        <nav className="svc-roles" aria-label="Service role">
          {ROLES.map((row) => (
            <button
              key={row.id}
              type="button"
              aria-current={role === row.id ? "page" : undefined}
              disabled={hostedAuth && row.id !== (devSession?.role || role)}
              onClick={() => chooseRole(row.id)}
            >
              {row.label}
            </button>
          ))}
        </nav>
        <label>
          Desk access
          <select aria-label="Desk access" value={access} onChange={(event) => { setAccess(event.target.value); setEditing(false); }}>
            <option value="host">Host</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        {databaseMode && devSession && (
          <button type="button" onClick={registerPasskey}>Register passkey</button>
        )}
        {editing && canEditFloor && (
          <button type="button" onClick={() => setEditing(false)}>Back to service</button>
        )}
        <details className="svc-dev">
          <summary>Developer</summary>
          <p className="svc-sim">{databaseMode
            ? "Local development database on this computer. Not production. Payments are not captured."
            : "Simulated service only. Payments, printers, guest notifications, and production systems are not connected."}</p>
          <p className="svc-truth">{ROLES.find((row) => row.id === role).hint}</p>
          {identity.ok ? (
            <p className="svc-truth" data-testid="service-identity">One order, one ticket, and one bill for each session.</p>
          ) : (
            <p role="alert" data-testid="service-identity">{reasonText(identity.reason)}</p>
          )}
          <p className="svc-truth" data-testid="service-summary">
            {databaseMode && !serviceLoaded
              ? "Restaurant service unavailable. Counts are not shown."
              : `${branch ? branch.label : "Branch unavailable"} · open sessions ${summary.openSessions} · paid bills ${summary.paidBills} · visits ${summary.visits} · consumption previews ${consumption.length} · stock posted ${consumption.filter((row) => row.postsStock).length} · ${databaseMode ? "local development database, not production" : "simulated, nothing written"}`}
            {serviceRead?.directAnswer ? ` Ask NAC: ${serviceRead.directAnswer}` : ""}
          </p>
        </details>
      </header>
      <p className="svc-banner" role="status" data-testid="service-banner">TEST MODE — NOT LIVE RESTAURANT OPERATIONS. {banner}</p>
      {databaseMode && !devSession && hostedAuth ? (
        <form className="svc-card" onSubmit={async (event) => {
          event.preventDefault();
          const result = await devState();
          if (result?.reason === "pilot_disabled") {
            setPilotClosed(true);
            return;
          }
          if (!result?.ok || !result.state) {
            setBanner(result?.reason === "sign_in_required"
              ? "Sign in to NAC OS first. The restaurant does not use a separate password."
              : "The restaurant service did not respond. Counts are not shown.");
            return;
          }
          setServiceLoaded(true);
          setDevSession({ ok: true, role: result.role, branchId: result.state.branchId, email: result.email });
          setRole(result.role);
          if (result.state.branchId) {
            setBranchId(result.state.branchId);
            setRestaurantBranch(result.state.branchId);
          }
          setRestaurant((prev) => ({ ...prev, state: result.state, menu: prev.menu }));
          setBanner("Signed in with the NAC OS session.");
        }}>
          <h2>NAC staff sign-in</h2>
          <p>Uses the NAC OS session already on this device. No restaurant password is stored here.</p>
          <button type="submit" className="svc-primary">Continue</button>
        </form>
      ) : databaseMode && !devSession ? (
        <form className="svc-card" onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const email = String(data.get("staff") || "");
          const password = String(data.get("password") || "");
          setDevEmail(email);
          setDevPassword(password);
          const result = await devLogin(email, password, email.startsWith("host.riyadh") ? "host" : email.split(".")[0]);
          if (!result?.ok) {
            setBanner(reasonText(result?.reason || "sign_in_failed"));
            return;
          }
          setDevToken(result.token);
          setDevSession(result);
          setRole(result.role);
          setBranchId(result.branchId);
          setBanner("Signed in to the local development database.");
        }}>
          <h2>Local development sign-in</h2>
          <p>Synthetic staff only. This password is not a production credential.</p>
          <label>
            Staff
            <select aria-label="Development staff" name="staff" value={devEmail} onChange={(event) => setDevEmail(event.target.value)}>
              <option value="host.khobar@nac.test">Host Khobar</option>
              <option value="waiter.khobar@nac.test">Waiter Khobar</option>
              <option value="kitchen.khobar@nac.test">Kitchen Khobar</option>
              <option value="cashier.khobar@nac.test">Cashier Khobar</option>
              <option value="host.riyadh@nac.test">Host Riyadh</option>
              <option value="manager.khobar@nac.test">Manager Khobar</option>
            </select>
          </label>
          <label>
            Password
            <input name="password" type="password" defaultValue="" autoComplete="current-password" />
          </label>
          <button type="submit" className="svc-primary">Sign in</button>
          <button type="button" onClick={loginWithPasskey}>Sign in with passkey</button>
        </form>
      ) : (
      <main>
        {editing && canEditFloor ? (
          <LayoutEditor
            serviceState={restaurant.state}
            layoutStorage={layoutStorage}
            initialDocument={layoutDoc}
            databaseMode={databaseMode}
            onOperate={dispatch}
            onSaved={(document) => {
              saveLayoutDocument(layoutStorage, document);
              setLayoutDoc(document);
              if (databaseMode) {
                const active = (document.layouts || []).find((row) => row.id === document.activeId) || document.layouts?.[0];
                dispatch("saveLayout", { name: active?.name || "Draft", document });
              }
            }}
            onClose={() => setEditing(false)}
          />
        ) : (
          <>
            {role === "manager" && databaseMode && <ManagerDashboard restaurant={restaurant} />}
            {(role === "host" || role === "manager") && <HostWorkspace key={branchId} {...shared} />}
            {role === "waiter" && <WaiterWorkspace key={branchId} {...shared} />}
            {role === "kitchen" && <KitchenWorkspace key={branchId} {...shared} />}
            {role === "cashier" && <CashierWorkspace key={branchId} {...shared} />}
          </>
        )}
      </main>
      )}
    </div>
  );
}
