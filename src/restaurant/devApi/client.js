const BASE = process.env.REACT_APP_RESTAURANT_API || "http://127.0.0.1:4193";
const KEY = "nac-dev-restaurant-token";

export function devToken() {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(KEY) || "";
}

export function setDevToken(token) {
  sessionStorage.setItem(KEY, token || "");
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
