import { supabase } from "../../lib/supabase";
import { restaurantApiBase, usesHostedRestaurantAuth } from "./endpoint";

const KEY = "nac-dev-restaurant-token";
const BRANCH_KEY = "nac-restaurant-branch";

export function devToken() {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(KEY) || "";
}

export function setDevToken(token) {
  sessionStorage.setItem(KEY, token || "");
}

export function setRestaurantBranch(branchId) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(BRANCH_KEY, branchId || "");
}

async function authorizationHeader() {
  if (usesHostedRestaurantAuth()) {
    const token = supabase ? (await supabase.auth.getSession()).data?.session?.access_token : "";
    return token ? `Bearer ${token}` : "";
  }
  return devToken() ? `Bearer ${devToken()}` : "";
}

async function request(path, body) {
  const base = restaurantApiBase();
  if (!base) return { ok: false, reason: "service_unavailable" };
  try {
    const headers = {
      "content-type": "application/json",
      authorization: await authorizationHeader(),
    };
    const branch = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(BRANCH_KEY) : "";
    if (branch) headers["x-nac-branch"] = branch;
    const response = await fetch(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers,
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

export function devState() {
  return request("/state");
}

export function devAct(action, payload, expectedRevision) {
  return request("/act", { action, payload, expectedRevision });
}

export function devJson(path, body) {
  return request(path, body || {});
}

export function devListen(onEvent) {
  const base = restaurantApiBase();
  if (usesHostedRestaurantAuth() || !base || typeof fetch === "undefined" || !devToken()) return () => {};
  const controller = new AbortController();
  fetch(`${base}/events`, {
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
