import assert from "node:assert/strict";
import { after, test } from "node:test";
import supernovaReview from "../netlify/functions/supernova-review.mjs";

const previousFetch = globalThis.fetch;
const previousUrl = process.env.REACT_APP_SUPABASE_URL;
const previousKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
after(() => {
  globalThis.fetch = previousFetch;
  if (previousUrl === undefined) delete process.env.REACT_APP_SUPABASE_URL;
  else process.env.REACT_APP_SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.REACT_APP_SUPABASE_ANON_KEY;
  else process.env.REACT_APP_SUPABASE_ANON_KEY = previousKey;
});

const site = { id: "cfdc09ad-5c90-4725-b2bd-7468d9f3a179" };
const qrUrl = "https://nac-os.netlify.app/r/supernova";
const reviewUrl = "https://search.google.com/local/writereview?placeid=ChIJ6UtqtvXvST4RScfi318vUrI";

test("each scan redirects immediately, records a separate event, and reuses the browser identifier", async () => {
  process.env.REACT_APP_SUPABASE_URL = "https://example.supabase.co";
  process.env.REACT_APP_SUPABASE_ANON_KEY = "test-public-key";
  const inserts = [];
  globalThis.fetch = async (url, init) => {
    inserts.push({ url, init });
    return new Response(null, { status: 201 });
  };
  const pending = [];
  const context = { site, waitUntil: (promise) => pending.push(promise) };

  const first = await supernovaReview(new Request(qrUrl), context);
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("Location"), reviewUrl);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  const cookie = first.headers.get("Set-Cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  await Promise.all(pending.splice(0));

  const second = await supernovaReview(new Request(qrUrl, { headers: { cookie: cookie.split(";")[0] } }), context);
  assert.equal(second.status, 302);
  assert.equal(second.headers.get("Set-Cookie"), null);
  await Promise.all(pending.splice(0));
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].url, "https://example.supabase.co/rest/v1/supernova_review_scans");
  assert.equal(inserts[0].init.method, "POST");
  assert.equal(JSON.parse(inserts[0].init.body).visitor_id, JSON.parse(inserts[1].init.body).visitor_id);
  assert.equal(Object.keys(JSON.parse(inserts[0].init.body)).join(), "visitor_id");
});

test("a delayed database call does not delay the Google redirect", async () => {
  let finish;
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  const pending = [];
  const response = await supernovaReview(new Request(qrUrl), { site, waitUntil: (promise) => pending.push(promise) });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), reviewUrl);
  finish(new Response(null, { status: 201 }));
  await Promise.all(pending);
});

test("tracking failure still opens Google and the route is unavailable on sibling sites", async () => {
  globalThis.fetch = async () => new Response(null, { status: 500 });
  const pending = [];
  const response = await supernovaReview(new Request(qrUrl), { site, waitUntil: (promise) => pending.push(promise) });
  assert.equal(response.status, 302);
  await Promise.all(pending);
  assert.equal((await supernovaReview(new Request(qrUrl), { site: { id: "other-site" } })).status, 404);
  assert.equal((await supernovaReview(new Request(qrUrl, { method: "POST" }), { site })).status, 405);
});
