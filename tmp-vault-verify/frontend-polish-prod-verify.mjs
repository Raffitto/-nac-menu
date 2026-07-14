/**
 * Production verification for c250c46 frontend polish (API layer).
 */
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

const PROD_URL = "https://nac-os.netlify.app";

async function getToken() {
  const admin = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: "raffiazarian2@gmail.com",
    options: { redirectTo: PROD_URL },
  });
  const user = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess } = await user.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  return sess.session.access_token;
}

async function ask(token, question, conversationContext = null) {
  const res = await fetch(`${url}/functions/v1/ask-nac`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", apikey: anon },
    body: JSON.stringify({ question, branch: "khobar", filters: { branch: "khobar" }, conversationContext }),
  });
  return res.json();
}

function directAnswerText(da) {
  if (typeof da === "string") return da;
  if (da && typeof da === "object") {
    return da.executiveSummary || da.answer || JSON.stringify(da);
  }
  return String(da ?? "");
}

async function main() {
  const html = await fetch(`${PROD_URL}/`).then((r) => r.text());
  const buildId = html.match(/build-id" content="([^"]+)"/)?.[1] || "unknown";
  const manifest = await fetch(`${PROD_URL}/asset-manifest.json`).then((r) => r.json());
  const chunk389 = manifest.files["static/js/389.a590a42c.chunk.js"]
    || Object.keys(manifest.files).find((k) => k.includes("389.") && k.endsWith(".chunk.js"));
  const chunkJs = chunk389 ? await fetch(`${PROD_URL}${manifest.files[chunk389] || chunk389}`).then((r) => r.text()) : "";
  const hasChartBundle = /visualize this once|conversation-chart/i.test(chunkJs);

  const token = await getToken();
  let ctx = null;
  const t1 = await ask(token, "Show net sales for last 7 days", ctx);
  ctx = t1.nextContext;
  const t2 = await ask(token, "Visualize it", ctx);

  const cashUp = await ask(token, "show latest cash up");
  const health = await ask(token, "health check");
  const dash = await ask(token, "dashboard readiness");

  const cashUpText = directAnswerText(cashUp.directAnswer);
  const results = {
    productionUrl: PROD_URL,
    buildId,
    hasChartBundle,
    chartApi: {
      t1Dataset: Boolean(t1.nextContext?.activeState?.dataset),
      t2UsedContext: t2.conversationResolution?.usedContext === true,
      t2HasDataset: Boolean(t2.conversationDataset?.dailyBreakdown?.length),
      t2DailyRows: t2.conversationDataset?.dailyBreakdown?.length || 0,
      t2Title: t2.title,
    },
    cashUp: {
      intent: cashUp.intent,
      hasExecutiveBrief: Boolean(cashUp.executiveBrief),
      directAnswerType: typeof cashUp.directAnswer,
      directAnswerPreview: cashUpText.slice(0, 160),
      objectObject: cashUpText.includes("[object Object]"),
      plainTextOk: typeof cashUp.directAnswer === "string" && !cashUpText.includes("[object Object]"),
    },
    regression: {
      health: health.intent,
      dashboard: dash.intent,
    },
  };

  console.log(JSON.stringify(results, null, 2));
  const pass = results.hasChartBundle
    && results.chartApi.t2UsedContext
    && results.chartApi.t2HasDataset
    && results.cashUp.plainTextOk
    && results.regression.health === "vault_knowledge_health"
    && results.regression.dashboard === "vault_knowledge_health";
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
