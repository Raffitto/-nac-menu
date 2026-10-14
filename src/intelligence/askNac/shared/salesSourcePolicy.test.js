import fs from "fs";
import path from "path";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../intentRouter";
import { selectSalesSource, SALES_SOURCE, mixedSalesComparisonLabel } from "./salesSourcePolicy";

const root = path.resolve(__dirname, "../../../..");
const clientPolicy = fs.readFileSync(path.join(root, "src/intelligence/askNac/shared/salesSourcePolicy.js"), "utf8");
const edgePolicy = fs.readFileSync(path.join(root, "supabase/functions/_shared/salesSourcePolicy.js"), "utf8");

const BRANCHES = ["", "Khobar ", "Riyadh ", "Jeddah "];

test("both routers import the same sales source policy text", () => {
  expect(clientPolicy).toBe(edgePolicy);
});

test("completed official sales from every branch use Cash Up", () => {
  const questions = [
    "sales yesterday",
    "yesterdays sales",
    "yesterday's sales",
    "Yesterday sales",
  ];
  for (const branch of BRANCHES) {
    for (const question of questions) {
      const asked = `${branch}${question}`.replace(/\s+/g, " ").trim();
      const placed = branch ? `${question} ${branch.trim()}` : question;
      for (const text of [asked, placed]) {
        expect(selectSalesSource(text)).toBe(SALES_SOURCE.CASH_UP);
        expect(routeAskNacIntent(text).intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
      }
    }
  }
});

test("current-day sales stay on Foodics and are not Cash Up", () => {
  for (const question of ["sales today", "today's sales", "revenue today", "net sales today", "sales so far today", "how much have we sold today"]) {
    expect(selectSalesSource(question)).toBe(SALES_SOURCE.FOODICS_LIVE);
    expect(routeAskNacIntent(question).intent).toBe(ASK_NAC_INTENTS.SALES_TOTAL);
  }
});

test("operational metrics stay on Foodics for a completed day", () => {
  for (const question of ["covers yesterday", "average check yesterday", "orders yesterday", "items sold yesterday", "waiter sales yesterday"]) {
    expect(selectSalesSource(question)).toBe(SALES_SOURCE.FOODICS_OPERATIONAL);
    expect(routeAskNacIntent(question).intent).not.toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  }
});

test("today versus yesterday names two sources and does not treat a missing Cash Up as Foodics", () => {
  const route = routeAskNacIntent("sales today vs yesterday");
  expect(selectSalesSource("sales today vs yesterday")).toBe(SALES_SOURCE.MIXED_TODAY_YESTERDAY);
  expect(route.intent).toBe(ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY);
  expect(route.salesSource).toBe(SALES_SOURCE.MIXED_TODAY_YESTERDAY);
  expect(mixedSalesComparisonLabel(false)).toMatch(/unavailable/i);
  expect(mixedSalesComparisonLabel(false)).toMatch(/not substituted/i);
  expect(mixedSalesComparisonLabel(true)).toMatch(/not accounting equivalents/i);
});
