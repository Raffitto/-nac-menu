/**
 * Local pilot-mode checks. Uses the database named by the environment.
 * Does not enable guest ordering or guest payments.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const api = process.env.JOURNEY_API || `http://127.0.0.1:${process.env.LOCAL_API_PORT || "4197"}`;
const container = process.env.JOURNEY_DB_CONTAINER || "nac-journey-db";
const dbName = process.env.JOURNEY_DB_NAME || process.env.LOCAL_DB_NAME || "nac_journey";
const password = process.env.LOCAL_DEV_PASSWORD || "local-dev";
const steps = [];

function record(name, ok, detail = "") {
  steps.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) throw new Error(`${name}: ${detail || "failed"}`);
}

function sql(text) {
  execFileSync("docker", [
    "exec", "-i", container, "psql", "-U", "postgres", "-d", dbName,
    "-v", "ON_ERROR_STOP=1", "-c", text,
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

async function call(pathname, token, body) {
  const response = await fetch(api + pathname, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

async function login(email, role) {
  return call("/login", null, { email, password, role });
}

function restartApi() {
  const port = new URL(api).port;
  return new Promise((resolve, reject) => {
    const child = spawn("zsh", ["-lc", `PID=$(lsof -nP -t -iTCP:${port} -sTCP:LISTEN || true); if [ -n "$PID" ]; then kill "$PID"; sleep 1; fi; set -a; . scripts/local-restaurant/.env; set +a; nohup node scripts/local-restaurant/server.mjs >> /tmp/nac-restaurant-api.log 2>&1 & disown`], {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("API restart timed out")), 20000);
    const probe = setInterval(async () => {
      try {
        const response = await fetch(`${api}/health`);
        const body = await response.json();
        if (body?.db === "up") {
          clearTimeout(timer);
          clearInterval(probe);
          resolve();
        }
      } catch {
        /* the replacement process is still starting */
      }
    }, 300);
    child.on("exit", (code) => {
      if (code) {
        clearTimeout(timer);
        clearInterval(probe);
        reject(new Error(`API restart shell exited ${code}`));
      }
    });
  });
}

async function main() {
  sql("delete from restaurant_owner_settings");
  const empty = await call("/pilot-status");
  const waiter = await login("waiter.khobar@nac.test", "waiter");
  const blocked = await call("/state", waiter.token);
  record("pilot off with no settings row", empty.restaurantPilot === false && empty.guestOrdering === false && empty.guestPayments === false && blocked.reason === "pilot_disabled");

  sql("insert into restaurant_owner_settings (branch_id, guest_ordering_enabled, guest_payments_enabled, restaurant_pilot_enabled) values ('khobar', false, false, false)");
  const explicit = await call("/state", waiter.token);
  const flags = await call("/pilot-status");
  record("pilot off with an explicit disabled row", explicit.reason === "pilot_disabled" && flags.restaurantPilot === false && flags.guestOrdering === false && flags.guestPayments === false);

  const anonymous = await call("/state");
  const anonymousAct = await call("/act", null, { action: "reserve", payload: {} });
  record("direct API access without a session is rejected", anonymous.reason === "sign_in_required" && anonymousAct.reason === "sign_in_required");

  const manager = await login("manager.khobar@nac.test", "manager");
  const managerOn = await call("/act", manager.token, { action: "setRestaurantPilot", payload: { branchId: "khobar", enabled: true } });
  record("manager cannot enable the pilot", managerOn.reason === "owner_required");

  sql("insert into restaurant_staff_grants (email, branch_id, role) values ('raffi@nac.com', 'khobar', 'administrator') on conflict do nothing");
  const owner = await login("raffi@nac.com", "administrator");
  const hettin = await call("/act", owner.token, { action: "setRestaurantPilot", payload: { branchId: "hettin", enabled: true } });
  const enabled = await call("/act", owner.token, { action: "setRestaurantPilot", payload: { branchId: "khobar", enabled: true } });
  record("owner can enable one branch and cannot enable Hettin", owner.ok === true && hettin.reason === "branch_forbidden" && enabled.restaurant_pilot_enabled === true && enabled.guest_ordering_enabled === false && enabled.guest_payments_enabled === false);

  const open = await call("/state", waiter.token);
  const riyadh = await login("host.riyadh@nac.test", "host");
  const foreign = await call("/state", riyadh.token);
  record("branch isolation keeps another branch closed", open.ok === true && open.state.branchId === "khobar" && foreign.reason === "pilot_disabled");

  const host = await login("host.khobar@nac.test", "host");
  const reserved = await call("/act", host.token, { action: "reserve", payload: { guestName: "Pilot Check", partySize: 2, date: "2026-11-12", time: "18:00" } });
  const reservationId = reserved.reservation?.id;
  await call("/act", host.token, { action: "markArrived", payload: reservationId });
  const seated = await call("/act", host.token, { action: "assignTable", payload: [reservationId, "khobar:24"] });
  const sessionId = `session-${reservationId}`;
  const opened = await call("/act", waiter.token, { action: "openSession", payload: "khobar:24" });
  const issued = await call("/act", waiter.token, { action: "issueGuestAccess", payload: { sessionId, label: "Pilot Check" } });
  const menu = await call("/guest/menu", null, { token: issued.token });
  const basket = await call("/guest/basket", null, { token: issued.token, itemId: "cd773179-5772-4539-97bd-c4790a0f5908", quantity: 1 });
  const submitted = await call("/guest/submit", null, { token: issued.token, idempotencyKey: "pilot-security" });
  const pay = await call("/act", (await login("cashier.khobar@nac.test", "cashier")).token, { action: "pay", payload: [sessionId, { amount: 1, tender: "card" }] });
  record("guest ordering and payments stay off while the pilot is on", seated.ok === true && opened.ok === true && menu.reason === "guest_ordering_disabled" && basket.reason === "guest_ordering_disabled" && submitted.reason === "guest_ordering_disabled" && pay.reason === "payment_not_authorized");

  sql("alter table restaurant_owner_settings rename to restaurant_owner_settings_hidden");
  let missing = null;
  let missingState = null;
  try {
    missing = await call("/pilot-status");
    missingState = await call("/state", waiter.token);
  } finally {
    sql("alter table restaurant_owner_settings_hidden rename to restaurant_owner_settings");
  }
  record("a missing settings table fails closed", missing.restaurantPilot === false && missing.guestOrdering === false && missing.guestPayments === false && missingState.reason === "pilot_disabled");

  let unavailable = false;
  try {
    await fetch("http://127.0.0.1:1/pilot-status");
  } catch {
    unavailable = true;
  }
  record("an unavailable restaurant API fails closed", unavailable);

  await restartApi();
  const afterRestart = await call("/state", waiter.token);
  record("pilot remains on after an API restart", afterRestart.ok === true && afterRestart.state.branchId === "khobar");

  const closed = await call("/act", owner.token, { action: "setRestaurantPilot", payload: { branchId: "khobar", enabled: false } });
  const blockedAgain = await call("/state", waiter.token);
  record("an open staff session is blocked after the pilot is switched off", closed.restaurant_pilot_enabled === false && closed.guest_ordering_enabled === false && closed.guest_payments_enabled === false && blockedAgain.reason === "pilot_disabled");

  await restartApi();
  const stillOff = await call("/state", waiter.token);
  const status = await call("/pilot-status");
  record("pilot stays off after another restart", stillOff.reason === "pilot_disabled" && status.restaurantPilot === false && status.guestOrdering === false && status.guestPayments === false);

  await call("/act", owner.token, { action: "setRestaurantPilot", payload: { branchId: "khobar", enabled: true } });
  await call("/act", owner.token, { action: "setRestaurantPilot", payload: { branchId: "riyadh", enabled: true } });
  const ready = await call("/pilot-status");
  record("isolated journey branches are on without guest ordering or payments", ready.restaurantPilot === true && ready.guestOrdering === false && ready.guestPayments === false);
  process.stdout.write(`pilot security steps ${steps.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
