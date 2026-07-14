/** Ask NAC verification queries */
import fs from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const REPO = "/Users/raffiazarian/Desktop/nac-menu";
const read = (k) => fs.readFileSync(`${REPO}/.env.local`, "utf8").match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const url = read("REACT_APP_SUPABASE_URL");
const anon = read("REACT_APP_SUPABASE_ANON_KEY");
const ref = url.match(/https:\/\/([^.]+)/)[1];
const sk = JSON.parse(execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: "utf8", cwd: REPO }))
  .find((k) => k.name === "service_role").api_key;

const QUERIES = [
  "show latest cash up",
  "summarize daily briefing this month",
  "show breakage issues this month",
  "show everything learned from historical weekly dashboards",
  "discover Drive folders",
];

async function main() {
  const admin = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "raffiazarian2@gmail.com",
    options: { redirectTo: "https://nac-os.netlify.app" },
  });
  const user = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  const token = sess.session.access_token;

  const results = [];
  for (const question of QUERIES) {
    const started = Date.now();
    const res = await fetch(`${url}/functions/v1/ask-nac`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question, branch: "khobar", filters: { branch: "khobar" } }),
    });
    const data = await res.json();
    const answer = typeof data.directAnswer === "string" ? data.directAnswer.slice(0, 220) : JSON.stringify(data.directAnswer)?.slice(0, 220);
    const pass = data.intent !== "unknown" && data.readiness?.status !== "missing" && data.readiness !== "missing";
    console.log(`\nQ: ${question}`);
    console.log(`  PASS=${pass} | ${Date.now() - started}ms | intent=${data.intent} | confidence=${data.confidence} | readiness=${data.readiness?.status || data.readiness}`);
    console.log(`  ${answer}`);
    results.push({ question, pass, intent: data.intent, confidence: data.confidence });
  }
  const failed = results.filter((r) => !r.pass);
  console.log("\n=== SUMMARY ===", failed.length ? "FAIL" : "ALL PASS", failed);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
