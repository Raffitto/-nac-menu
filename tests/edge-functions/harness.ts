// Loads the REAL vault-drive-sync handler with Deno.serve captured. Google OAuth is answered by a
// local fake fetch; any other outbound request throws. Run with --deny-net.
import { resetState, state } from "./stubs/state.ts";

export const SERVICE_KEY = "test-service-role-key-" + crypto.randomUUID();
export const SCHED_SECRET = "test-scheduled-secret-" + crypto.randomUUID();

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9/offline-stub");
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("DRIVE_SCHEDULED_INGEST_SECRET", SCHED_SECRET);
Deno.env.set("GOOGLE_CLIENT_ID", "test-client-id");
Deno.env.set("GOOGLE_CLIENT_SECRET", "test-client-secret");

globalThis.fetch = ((input: Request | URL | string) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://oauth2.googleapis.com/token") {
    return Promise.resolve(new Response(JSON.stringify({ access_token: "test-google-access", expires_in: 3600 }), { status: 200 }));
  }
  return Promise.reject(new Error(`offline test: unexpected fetch to ${url}`));
}) as typeof fetch;

let handler: ((req: Request) => Promise<Response>) | null = null;
Object.defineProperty(Deno, "serve", {
  value: (h: (req: Request) => Promise<Response>) => { handler = h; return { finished: Promise.resolve() }; },
  configurable: true, writable: true,
});
await import("../../supabase/functions/vault-drive-sync/index.ts");
if (!handler) throw new Error("vault-drive-sync handler not captured");

export { resetState, state };

export async function call(body: Record<string, unknown>, auth?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  const res = await handler!(new Request("http://localhost/functions/v1/vault-drive-sync", {
    method: "POST", headers, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
}

const b64url = (s: string | Uint8Array) => {
  const bytes = typeof s === "string" ? new TextEncoder().encode(s) : s;
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};
export function unsignedJwt(payload: Record<string, unknown>) {
  return `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}.`;
}
export async function hs256Jwt(payload: Record<string, unknown>, secret: string) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
