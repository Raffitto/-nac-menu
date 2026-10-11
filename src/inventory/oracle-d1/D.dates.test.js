/**
 * Oracle D1 — D. Dates and timezone, Asia/Riyadh (T14-T17).
 * Rules: dates are Riyadh calendar dates; a business day is complete only after
 * 08:00 AST the next morning (latestCompletedBusinessDate); the window is also
 * capped by commerce_dataset_freshness.data_through. A window that is not fully
 * complete is UNAVAILABLE with missingDates and the available sub-window.
 * Recipe version on a business date = the version active at business-day close
 * (23:59:59.999 +03:00).
 */
import { consumptionWindow, resolveConsumptionWindow } from "../intelligence/consumptionEvidence";
import { queryIngredientConsumption } from "../intelligence/recipeConsumptionApi";
import { buildRecipeGraph, selectAnalyticalVersion } from "../truth/recipeGraph";
import { computeTheoreticalLedger } from "../truth/consumption";
import { GRAPH_STATUS } from "../truth/contracts";
import { versionCoversTimestamp } from "../truth/recipeValidityContract";
import { allTrackedWriteCalls, trackedStub } from "../__fixtures__/oracle-d1/supabaseStub";
import { consumptionTables, SYN_INGREDIENTS, synGraph, synItem } from "../__fixtures__/oracle-d1/synFixtures";

function expectUnavailable(result, pattern) {
  expect(result.status).toBe("UNAVAILABLE");
  expect(result.quantity).toBeNull();
  expect(result.reason).toEqual(expect.any(String));
  expect(result.reason).toMatch(pattern);
  expect(result.postsStock).toBe(false);
}

describe("T14 AST day boundary for 'yesterday'", () => {
  const NOW = "2026-10-11T22:30:00Z"; // 2026-10-12 01:30 AST

  test("yesterday is the Riyadh date 2026-10-11, not the UTC slice 2026-10-10", () => {
    expect(consumptionWindow("yesterday", new Date(NOW))).toMatchObject({ start: "2026-10-11", end: "2026-10-11" });
  });

  test("08:00 AST cutoff: latest completed day is 2026-10-10, so 2026-10-11 is UNAVAILABLE", () => {
    const window = resolveConsumptionWindow("yesterday", { now: NOW });
    expect(window.requestedStart).toBe("2026-10-11");
    expect(window.latestCompletedDate).toBe("2026-10-10");
    expect(window.status).toBe("UNAVAILABLE");
    expect(window.missingDates).toEqual(["2026-10-11"]);
    expect(window.reason).toMatch(/not complete/);
  });

  test("after 08:00 AST the same yesterday is complete", () => {
    const window = resolveConsumptionWindow("yesterday", { now: "2026-10-12T05:00:00Z" });
    expect(window).toMatchObject({ start: "2026-10-11", end: "2026-10-11", status: "OK", missingDates: [] });
  });

  test("end to end through the Ask NAC tool", async () => {
    const stub = trackedStub({ tables: consumptionTables({ items: [synItem({ id: "SYN-I-T14", date: "2026-10-11", menuItemId: "SYN-M-LATTE" })] }) });
    const result = await queryIngredientConsumption(stub, { question: "How much SYN-milk should Khobar have consumed yesterday?", now: NOW });
    expectUnavailable(result, /not complete/);
    expect(result.missingDates).toEqual(["2026-10-11"]);
    expect(stub.readsOf("commerce_order_items")).toHaveLength(0);
  });
});

describe("T15 'today' is refused", () => {
  test("UNAVAILABLE (business day not complete) with missingDates", async () => {
    const stub = trackedStub({ tables: consumptionTables({ items: [synItem({ id: "SYN-I-T15", date: "2026-10-12", menuItemId: "SYN-M-LATTE" })] }) });
    const result = await queryIngredientConsumption(stub, { question: "How much SYN-milk did Khobar consume today?", now: "2026-10-12T15:00:00Z" });
    expectUnavailable(result, /Business day 2026-10-12 is not complete/);
    expect(result.missingDates).toEqual(["2026-10-12"]);
  });
});

describe("T16 freshness clipping", () => {
  const NOW = "2026-10-11T09:00:00Z"; // 12:00 AST on 11 Oct: last week = 04..10

  test("data_through 2026-10-08: the 04..10 week is UNAVAILABLE with missing dates and the 04..08 window", () => {
    const window = resolveConsumptionWindow("last_week", { now: NOW, publishedThrough: "2026-10-08" });
    expect(window.requestedStart).toBe("2026-10-04");
    expect(window.requestedEnd).toBe("2026-10-10");
    expect(window.status).toBe("UNAVAILABLE");
    expect(window.missingDates).toEqual(["2026-10-09", "2026-10-10"]);
    expect(window.availableWindow).toEqual({ start: "2026-10-04", end: "2026-10-08" });
    expect(window.reason).toMatch(/published through 2026-10-08/);
  });

  test("end to end: never a 7-day label on 5 days of data", async () => {
    const items = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((date, i) => (
      synItem({ id: `SYN-I-T16-${i}`, date, menuItemId: "SYN-M-LATTE" })
    ));
    const stub = trackedStub({ tables: consumptionTables({ items, freshness: "2026-10-08" }) });
    const result = await queryIngredientConsumption(stub, { question: "How much SYN-milk should Khobar have consumed last week?", now: NOW });
    expectUnavailable(result, /2026-10-09, 2026-10-10 are not published/);
    expect(result.missingDates).toEqual(["2026-10-09", "2026-10-10"]);
    expect(result.availableWindow).toEqual({ start: "2026-10-04", end: "2026-10-08" });
  });
});

describe("T17 version effective time on the business date", () => {
  const recipe = {
    id: "SYN-R-T17",
    name: "SYN Latte",
    menuItemId: "SYN-M-LATTE",
    versions: [
      { id: "SYN-R-T17-V1", status: "retired", effectiveTo: "2026-10-10T10:00:00+03:00", lines: [{ ingredientId: SYN_INGREDIENTS.milk.id, quantity: "100", unit: "ml" }] },
      { id: "SYN-R-T17-V2", status: "active", effectiveFrom: "2026-10-10T10:00:00+03:00", lines: [{ ingredientId: SYN_INGREDIENTS.milk.id, quantity: "150", unit: "ml" }] },
    ],
  };
  const graphInput = synGraph([recipe]);

  test("business date 2026-10-10 selects V2 (active at business-day close), not MULTIPLE_ACTIVE_VERSIONS", () => {
    const [v1, v2] = graphInput.versions;
    expect(versionCoversTimestamp(v1, "2026-10-10")).toBe(false);
    expect(versionCoversTimestamp(v2, "2026-10-10")).toBe(true);
    const selected = selectAnalyticalVersion(graphInput.versions, { asOf: "2026-10-10" });
    expect(selected.status).toBe(GRAPH_STATUS.OK);
    expect(selected.version.id).toBe("SYN-R-T17-V2");
    expect(selectAnalyticalVersion(graphInput.versions, { asOf: "2026-10-09" }).version.id).toBe("SYN-R-T17-V1");
  });

  test("ledger on 2026-10-10 uses V2 deterministically", () => {
    const ledger = computeTheoreticalLedger({
      salesRows: [{ matched_menu_item_id: "SYN-M-LATTE", raw_item_name: "SYN Latte", quantity_sold: 2, business_date: "2026-10-10" }],
      graph: buildRecipeGraph(graphInput),
      graphAt: (asOf) => buildRecipeGraph({ ...graphInput, asOf }),
      periodStart: "2026-10-10",
      periodEnd: "2026-10-10",
    });
    const milk = ledger.rows.find((row) => row.canonicalIngredientId === SYN_INGREDIENTS.milk.id);
    expect(milk.quantityTheoreticallyConsumed).toBe("300");
    expect(milk.baseUom).toBe("millilitre");
  });
});

describe("T28 (D)", () => {
  test("no insert/update/upsert/delete/rpc on any stub in this file", () => {
    expect(allTrackedWriteCalls()).toEqual([]);
  });
});
