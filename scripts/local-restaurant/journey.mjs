/**
 * Repeatable local journey. It uses the shared development database.
 * A step is recorded only after its assertion succeeds.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const outDir = path.join(root, "scripts/local-restaurant/journey-output");
const apiPort = process.env.JOURNEY_API_PORT || "4193";
const api = process.env.JOURNEY_API || `http://127.0.0.1:${apiPort}`;
const desk = process.env.JOURNEY_DESK || "http://localhost:4192/?restaurant-db=1";
const dbContainer = process.env.JOURNEY_DB_CONTAINER || "nac-reservations-dev";
const dbName = process.env.JOURNEY_DB_NAME || "nac_reservations_dev";
const password = process.env.LOCAL_DEV_PASSWORD || "local-dev";
const stamp = String(Date.now()).slice(-6);
const guestName = `Journey ${stamp}`;
const olives = "cd773179-5772-4539-97bd-c4790a0f5908";
const eggs = "7b879a69-8d4d-4853-8bea-544266c9cf61";
const steps = [];

function record(name, ok, detail) {
  steps.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) throw new Error(`${name}: ${detail || "failed"}`);
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
  const payload = await response.json();
  return payload;
}

async function signIn(page, email) {
  await page.goto(desk, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Development staff").selectOption(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Signed in to the local development database.").waitFor({ timeout: 20000 });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: false });
}

function restartApi() {
  return new Promise((resolve, reject) => {
    const child = spawn("zsh", ["-lc", `PID=$(lsof -nP -t -iTCP:${apiPort} -sTCP:LISTEN || true); if [ -n "$PID" ]; then kill "$PID"; sleep 1; fi; set -a; . scripts/local-restaurant/.env; set +a; exec node scripts/local-restaurant/server.mjs`], {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    const timer = setTimeout(() => reject(new Error("API restart timed out")), 20000);
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
      if (text.includes("local restaurant api on")) {
        clearTimeout(timer);
        child.unref();
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code) {
        clearTimeout(timer);
        reject(new Error(text || `API exited ${code}`));
      }
    });
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const host = await call("/login", null, { email: "host.khobar@nac.test", password, role: "host" });
  const waiter = await call("/login", null, { email: "waiter.khobar@nac.test", password, role: "waiter" });
  const kitchen = await call("/login", null, { email: "kitchen.khobar@nac.test", password, role: "kitchen" });
  const cashier = await call("/login", null, { email: "cashier.khobar@nac.test", password, role: "cashier" });
  const manager = await call("/login", null, { email: "manager.khobar@nac.test", password, role: "manager" });
  const riyadh = await call("/login", null, { email: "host.riyadh@nac.test", password, role: "host" });
  record("staff sign-in", [host, waiter, kitchen, cashier, manager, riyadh].every((row) => row.ok));

  const browser = await chromium.launch({ headless: true });
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const kitchenContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const hostPage = await hostContext.newPage();
  const kitchenPage = await kitchenContext.newPage();
  await signIn(hostPage, "host.khobar@nac.test");
  await signIn(kitchenPage, "kitchen.khobar@nac.test");
  await shot(hostPage, "01-host-signed-in.png");
  await shot(kitchenPage, "02-kitchen-signed-in.png");
  record("independent browser sessions", true, "host and kitchen");

  const before = await call("/state", host.token);
  const busy = new Set((before.state.sessions || []).filter((row) => row.status === "open").map((row) => row.tableId));
  (before.state.reservations || []).filter((row) => row.status === "seated").forEach((row) => busy.add(row.tableId));
  let free = (before.state.tables || []).filter((row) => !busy.has(row.id) && row.active !== false && !row.removed && !row.hold);
  for (const table of before.state.tables || []) {
    if (free.length >= 2) break;
    if (!busy.has(table.id) && table.hold === "cleaning") {
      const cleared = await call("/act", host.token, { action: "setTableHold", payload: [table.id, null] });
      if (cleared.ok) free.push(table);
    }
  }
  record("two free tables", free.length >= 2, free.map((row) => row.label).join(", "));
  const [seat, destination] = free;

  const reserved = await call("/act", host.token, {
    action: "reserve",
    payload: { guestName, phone: `05${stamp}99`, partySize: 2, date: "2026-11-10", time: "20:00" },
  });
  record("host creates a reservation", reserved.ok === true, reserved.reservation?.id);
  const reservationId = reserved.reservation.id;
  const arrived = await call("/act", host.token, { action: "markArrived", payload: reservationId });
  record("guest arrives", arrived.ok === true);
  const seated = await call("/act", host.token, { action: "assignTable", payload: [reservationId, seat.id] });
  record("host seats the guest", seated.ok === true, seat.label);
  await hostPage.getByRole("button", { name: guestName }).first().waitFor({ timeout: 15000 });
  await shot(hostPage, "03-host-sees-guest.png");
  record("host browser shows the reservation", true);

  const opened = await call("/act", waiter.token, { action: "openSession", payload: seat.id });
  record("waiter opens the dining session", opened.ok === true);
  const sessionId = `session-${reservationId}`;
  const firstItem = await call("/act", waiter.token, {
    action: "addItem",
    payload: [sessionId, { itemId: olives, quantity: 1, modifierIds: [], instructions: "", clientKey: `journey-olives-${stamp}` }],
  });
  const secondItem = await call("/act", waiter.token, {
    action: "addItem",
    payload: [sessionId, { itemId: eggs, quantity: 1, modifierIds: [], instructions: "", clientKey: `journey-eggs-${stamp}` }],
  });
  record("waiter orders catalogue items", firstItem.ok === true && secondItem.ok === true);
  const ordered = await call("/state", kitchen.token);
  const order = ordered.state.orders.find((row) => row.sessionId === sessionId);
  const olive = order.items.find((item) => item.name === "Olives");
  const egg = order.items.find((item) => item.name.includes("Eggs"));
  record("kitchen receives the order", Boolean(olive && egg));
  const preparing = await call("/act", kitchen.token, { action: "setItemStatus", payload: [olive.id, "preparing"] });
  const ready = await call("/act", kitchen.token, { action: "setItemStatus", payload: [olive.id, "ready"] });
  record("kitchen marks an item preparing and ready", preparing.ok === true && ready.ok === true);
  const waiterView = await call("/state", waiter.token);
  const seen = waiterView.state.orders.find((row) => row.sessionId === sessionId).items.find((item) => item.id === olive.id);
  record("waiter receives the ready status", seen.status === "ready");
  await kitchenPage.locator(".svc-status", { hasText: "Ready" }).first().waitFor({ state: "visible", timeout: 15000 });
  await shot(kitchenPage, "04-kitchen-ready.png");
  record("kitchen browser shows ready", true);

  const moved = await call("/act", host.token, { action: "transferTable", payload: [sessionId, destination.id] });
  const afterMove = await call("/state", waiter.token);
  const movedOrder = afterMove.state.orders.find((row) => row.id === order.id);
  const movedSession = afterMove.state.sessions.find((row) => row.id === sessionId);
  record("table move keeps the same session and order", moved.ok === true && movedOrder.sessionId === sessionId && movedSession.tableId === destination.id, destination.label);

  const bill = await call("/act", cashier.token, { action: "openBill", payload: sessionId });
  record("cashier opens the bill", bill.ok === true);
  const denied = await call("/act", cashier.token, {
    action: "discountBill",
    payload: { billId: `bill:${sessionId}`, basis: "percent", value: 10, reason: "Cashier discount", idempotencyKey: `deny-${stamp}` },
  });
  record("cashier discount is rejected", denied.reason === "role_forbidden", denied.reason);
  const discount = await call("/act", manager.token, {
    action: "discountBill",
    payload: { billId: `bill:${sessionId}`, basis: "percent", value: 10, reason: "Journey discount", idempotencyKey: `discount-${stamp}` },
  });
  const voided = await call("/act", manager.token, {
    action: "voidItem",
    payload: { billId: `bill:${sessionId}`, itemId: olive.id, reason: "Journey void", idempotencyKey: `void-${stamp}` },
  });
  record("manager authorizes the discount and void", discount.ok === true && voided.ok === true);
  const split = await call("/act", cashier.token, {
    action: "splitBill",
    payload: { billId: `bill:${sessionId}`, parts: 2, reason: "Journey split", idempotencyKey: `split-${stamp}` },
  });
  const billed = await call("/state", cashier.token);
  const checks = billed.state.bills.filter((row) => row.sessionId === sessionId);
  const unpaid = checks.every((row) => row.paid === false && row.status === "open");
  const sum = checks.reduce((total, row) => total + Math.round(Number(row.outstanding) * 100), 0);
  record("split checks stay unpaid", split.ok === true && unpaid, `minor units ${sum}`);

  const layoutText = await new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", dbContainer, "psql", "-U", "postgres", "-d", dbName, "-tA", "-c", "select document::text from restaurant_floor_layouts where branch_id = 'khobar' and status = 'published' and document ? 'layouts' order by created_at desc limit 1"], { cwd: root });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.on("exit", (code) => (code === 0 ? resolve(text.trim()) : reject(new Error("layout query failed"))));
  });
  const document = JSON.parse(layoutText);
  const hostRevision = await hostPage.getAttribute("[data-testid=restaurant-sim]", "data-revision");
  const published = await call("/act", manager.token, { action: "saveLayout", payload: { name: document.name || "Khobar draft", document } });
  record("manager republishes the current floor", published.ok === true);
  await hostPage.waitForFunction((previous) => {
    const node = document.querySelector("[data-testid=restaurant-sim]");
    return node && node.getAttribute("data-revision") !== previous;
  }, hostRevision, { timeout: 15000 });
  await shot(hostPage, "05-host-saw-floor-event.png");
  record("another browser receives the floor event", true);

  const foreign = await call("/state", riyadh.token);
  record("cross-branch sessions stay hidden", foreign.state.branchId === "riyadh" && foreign.state.sessions.length === 0);
  const pay = await call("/act", cashier.token, { action: "pay", payload: [sessionId, { amount: 1, tender: "card" }] });
  record("payment capture stays rejected", pay.reason === "payment_not_authorized", pay.reason);

  await restartApi();
  const again = await call("/login", null, { email: "cashier.khobar@nac.test", password, role: "cashier" });
  const preserved = await call("/state", again.token);
  const stillThere = preserved.state.orders.some((row) => row.sessionId === sessionId);
  record("API restart preserves the order", again.ok === true && stillThere);

  const closed = await call("/act", cashier.token, { action: "closeTable", payload: sessionId });
  const history = await call("/state", host.token);
  const visit = history.state.visits.find((row) => row.sessionId === sessionId);
  record("completed visit is unpaid and verified", closed.ok === true && visit && visit.paymentCaptured === false && Number.isFinite(visit.total), visit ? `${visit.total} SAR` : "missing");
  const openVisit = history.state.visits.find((row) => row.sessionId === "session-dc31b9bb-b5b1-4f6b-ae65-cd0aa1755667");
  record("an open session is not written as a completed visit", !openVisit);

  const health = await call("/health");
  record("health check sees the database", health.ok === true && health.db === "up" && health.production === false);

  await browser.close();
  await writeFile(path.join(outDir, "results.json"), JSON.stringify({ guestName, sessionId, steps }, null, 2));
  process.stdout.write(`journey steps ${steps.length}\n`);
}

main().catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  await mkdir(outDir, { recursive: true }).catch(() => {});
  await writeFile(path.join(outDir, "results.json"), JSON.stringify({ failed: true, error: error.message, steps }, null, 2)).catch(() => {});
  process.exit(1);
});
