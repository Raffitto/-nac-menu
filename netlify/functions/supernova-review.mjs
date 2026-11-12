const NAC_OS_SITE_ID = "cfdc09ad-5c90-4725-b2bd-7468d9f3a179";
const GOOGLE_WRITE_REVIEW_URL =
  "https://search.google.com/local/writereview?placeid=ChIJ6UtqtvXvST4RScfi318vUrI";
const COOKIE_NAME = "supernova_review_visitor";

function setting(name) {
  return String(globalThis.Netlify?.env?.get?.(name) || process.env[name] || "");
}

export async function recordSupernovaScan(visitorId, fetcher = fetch) {
  const url = setting("REACT_APP_SUPABASE_URL") || setting("SUPABASE_URL");
  const key = setting("REACT_APP_SUPABASE_ANON_KEY") || setting("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Supabase scan tracking is not configured");

  const response = await fetcher(`${url.replace(/\/$/, "")}/rest/v1/supernova_review_scans`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ visitor_id: visitorId }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Scan tracking returned ${response.status}`);
}

export default async function supernovaReview(request, context) {
  if (context?.site?.id !== NAC_OS_SITE_ID) return new Response(null, { status: 404 });
  if (request.method !== "GET") return new Response(null, { status: 405 });

  const cookie = request.headers.get("cookie") || "";
  const savedId = cookie.match(/(?:^|;\s*)supernova_review_visitor=([0-9a-f-]{36})(?:;|$)/i)?.[1];
  const visitorId = savedId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(savedId)
    ? savedId
    : crypto.randomUUID();

  const record = recordSupernovaScan(visitorId).catch((error) => {
    console.error("Supernova scan tracking failed:", error.message);
  });
  if (typeof context.waitUntil === "function") context.waitUntil(record);
  else await record;

  const headers = new Headers({
    Location: GOOGLE_WRITE_REVIEW_URL,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (!savedId || savedId !== visitorId) {
    headers.set("Set-Cookie", `${COOKIE_NAME}=${visitorId}; Path=/r/supernova; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
  }
  return new Response(null, { status: 302, headers });
}

export const config = { path: "/r/supernova" };
