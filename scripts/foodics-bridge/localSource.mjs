/**
 * Local authenticated Foodics source. Reuses existing session/env; never commits secrets.
 * Network is used only when a session artifact is actually present.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE = "https://console.foodics.com";

export function loadEnvFile(filePath, into = {}) {
  if (!filePath || !fs.existsSync(filePath)) return into;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (into[key] == null || into[key] === "") into[key] = value;
  }
  return into;
}

function readCookieHeader(env, bridgeHome) {
  if (env.FOODICS_CONSOLE_COOKIE) return env.FOODICS_CONSOLE_COOKIE;
  if (env.FOODICS_SESSION_COOKIE) return env.FOODICS_SESSION_COOKIE;
  if (env.FOODICS_AUTH_TOKEN && !env.FOODICS_AUTHORIZATION) {
    env.FOODICS_AUTHORIZATION = env.FOODICS_AUTH_TOKEN.startsWith("Bearer ")
      ? env.FOODICS_AUTH_TOKEN
      : `Bearer ${env.FOODICS_AUTH_TOKEN}`;
  }
  const candidates = [
    env.FOODICS_SESSION_FILE,
    path.join(bridgeHome, "session", "cookies.txt"),
    path.join(bridgeHome, "cookies.txt"),
  ].filter(Boolean);
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) continue;
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.cookie === "string") return parsed.cookie;
        if (Array.isArray(parsed)) {
          return parsed.map((row) => `${row.name}=${row.value}`).join("; ");
        }
      } catch {
        return raw;
      }
    }
    return raw.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).join("; ");
  }
  return null;
}

export function parseListingPayload(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.data?.data)
        ? payload.data.data
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
  const orderIds = rows.map((row) => String(row?.id || row?.uuid || "")).filter(Boolean);
  return { orderIds, listingCount: orderIds.length };
}

export async function loadLocalAuthenticatedSource(input = {}) {
  const env = { ...input.env };
  const bridgeHome = input.bridgeHome;
  loadEnvFile(path.join(bridgeHome, ".env.local"), env);
  loadEnvFile(input.repoEnvFile, env);

  const helperCandidates = [
    env.FOODICS_BRIDGE_SOURCE_MODULE,
    path.join(bridgeHome, "nac-source.mjs"),
    path.join(bridgeHome, "authenticated-source.mjs"),
    path.join(bridgeHome, "src/foodicsSource.mjs"),
  ].filter(Boolean);
  for (const modulePath of helperCandidates) {
    if (!fs.existsSync(modulePath)) continue;
    const mod = await import(pathToFileUrl(modulePath));
    if (typeof mod.createAuthenticatedFoodicsSource === "function") {
      return {
        kind: "local_helper",
        ready: true,
        source: await mod.createAuthenticatedFoodicsSource({ env, bridgeHome }),
        modulePath,
      };
    }
  }

  const cookie = readCookieHeader(env, bridgeHome);
  const authorization = env.FOODICS_AUTHORIZATION || env.FOODICS_CONSOLE_AUTHORIZATION || null;
  if (!cookie && !authorization) {
    return { kind: "none", ready: false, source: null, reason: "foodics_session_unavailable" };
  }

  const base = (env.FOODICS_CONSOLE_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (env.FOODICS_AUTH_HEADERS_JSON) {
    try {
      Object.assign(headers, JSON.parse(env.FOODICS_AUTH_HEADERS_JSON));
    } catch {
      // ignore malformed header JSON; cookie/authorization still apply
    }
  }
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;

  return {
    kind: "cookie_http",
    ready: true,
    source: {
      async listOrders({ businessDate, branchId }) {
        const url = env.FOODICS_LISTING_URL || `${base}/core-api/listing?url=/orders`;
        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            page: 1,
            limit: 500,
            filters: { business_date: businessDate, branch: branchId },
          }),
        });
        if (!res.ok) throw new Error(`foodics_listing_${res.status}`);
        return parseListingPayload(await res.json());
      },
      async fetchOrderDetail({ orderId }) {
        const url = env.FOODICS_GETTING_URL
          || `${base}/core-api/getting?url=/orders&id=${encodeURIComponent(orderId)}`;
        const res = await fetchImpl(url, { method: "GET", headers });
        if (!res.ok) throw new Error(`foodics_getting_${res.status}:${orderId}`);
        return res.json();
      },
    },
  };
}

function pathToFileUrl(filePath) {
  const abs = path.resolve(filePath);
  return `file://${abs}`;
}
