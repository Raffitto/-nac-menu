/**
 * Hosted-auth checks against the isolated local database.
 * Does not enable the pilot, guest ordering, or guest payments.
 */
import { readFileSync } from "node:fs";

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/\r$/, "");
  }
  return env;
}

const env = loadEnv(new URL("./.env", import.meta.url));
process.env.RESTAURANT_AUTH_MODE = "supabase";
process.env.RESTAURANT_DATABASE_URL = `postgresql://nac_restaurant_api:${encodeURIComponent(env.LOCAL_API_ROLE_PASSWORD)}@127.0.0.1:${env.LOCAL_DB_PORT}/${env.LOCAL_DB_NAME}`;

const { handleWebRequest } = await import("./server.mjs");
const { setSupabaseUserVerifier } = await import("./hostedAuth.mjs");

function record(name, ok, detail = "") {
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) throw new Error(name);
}

async function call(pathname, { token = "", branch = "", role = "", body = null, method = "GET" } = {}) {
  const headers = { origin: "http://localhost:4196" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (branch) headers["x-nac-branch"] = branch;
  if (role) headers["x-nac-role"] = role;
  const request = new Request(`http://127.0.0.1${pathname}`, {
    method: body ? "POST" : method,
    headers: { ...headers, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const response = await handleWebRequest(request);
  const payload = await response.json();
  return { status: response.status, payload };
}

setSupabaseUserVerifier(async (token) => (
  token === "header.payload.signature" ? { email: "waiter.khobar@nac.test", id: "test" } : null
));

const login = await call("/api/restaurant/login", { body: { email: "waiter.khobar@nac.test", password: "local-dev", role: "administrator" } });
record("hosted mode refuses the development password", login.payload.reason === "dev_auth_disabled");

const status = await call("/api/restaurant/pilot-status");
record("pilot status stays off", status.payload.restaurantPilot === false && status.payload.guestOrdering === false && status.payload.guestPayments === false);

const anonymous = await call("/api/restaurant/state", { token: "not-a-jwt" });
record("a token that is not a session is rejected", anonymous.payload.reason === "sign_in_required");

const forged = await call("/api/restaurant/state", {
  token: "header.payload.signature",
  branch: "khobar",
  role: "administrator",
});
record("a forged administrator role cannot read a closed pilot", forged.payload.reason === "pilot_disabled" && forged.payload.role !== "administrator");

const foreign = await call("/api/restaurant/state", {
  token: "header.payload.signature",
  branch: "riyadh",
  role: "manager",
});
record("another branch is rejected from the database grant", foreign.payload.reason === "branch_forbidden");

const events = await call("/api/restaurant/events", { token: "header.payload.signature", branch: "khobar" });
record("a closed pilot does not open an event stream", events.payload.reason === "pilot_disabled" && events.payload.realtime !== "events");

process.stdout.write("hosted gate steps 6\n");
