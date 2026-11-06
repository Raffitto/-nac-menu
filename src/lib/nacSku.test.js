import fs from "fs";
import path from "path";
import {
  classifyFoodicsSkuOverlap,
  foodicsRecordsAreSame,
  formatNacCode,
  nextNacCode,
  parseNacCode,
  scanNacCodes,
} from "./nacSku";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/20261106104500_nac_catalogue_identities.sql"),
  "utf8",
);

describe("NAC codes", () => {
  test("allocates stable codes and never reuses a retired number", () => {
    const first = nextNacCode("finished_product", []);
    expect(first).toBe("NAC-P-0001");
    expect(parseNacCode("nac-pr-12").code).toBe("NAC-PR-0012");
    const next = nextNacCode("finished_product", [
      { nac_code: "NAC-P-0001", retired_at: "2026-11-01" },
      { nac_code: "NAC-I-0004" },
    ]);
    expect(next).toBe("NAC-P-0002");
    expect(formatNacCode("recipe", 3)).toBe("NAC-R-0003");
    expect(nextNacCode("preparation", [{ nac_code: "NAC-P-0009" }])).toBe("NAC-PR-0001");
  });

  test("a finished product and an ingredient may share a Foodics SKU", () => {
    const product = {
      entityType: "finished_product",
      foodicsId: "97c447cd-37e3-4f28-8942-dfd811fa5a4f",
      sku: "sk-1320",
    };
    const ingredient = {
      entityType: "ingredient",
      foodicsId: "ingredient-record-1",
      sku: "sk-1320",
    };
    expect(foodicsRecordsAreSame(product, ingredient)).toBe(false);
    expect(foodicsRecordsAreSame(product, { ...product })).toBe(true);
    const findings = classifyFoodicsSkuOverlap([product, ingredient]);
    expect(findings.map((row) => row.code)).toEqual(["foodics_sku_shared_across_types"]);
    expect(findings[0].severity).toBe("INFORMATIONAL");
  });

  test("the same Foodics SKU on two product records stays unresolved", () => {
    const findings = classifyFoodicsSkuOverlap([
      { entityType: "finished_product", foodicsId: "pos-a", sku: "sk-0647" },
      { entityType: "finished_product", foodicsId: "pos-b", sku: "sk-0647" },
    ]);
    expect(findings.some((row) => row.code === "ambiguous_foodics_identity")).toBe(true);
    expect(findings.some((row) => row.code === "foodics_sku_shared_across_types")).toBe(false);
  });

  test("duplicate NAC codes are critical and missing codes are not invented", () => {
    const findings = scanNacCodes(
      [
        { nac_code: "NAC-P-0001", target_kind: "menu_item", target_id: "toast-a" },
        { nac_code: "NAC-P-0001", target_kind: "menu_item", target_id: "toast-b" },
      ],
      { activeTargets: [{ id: "toast-a", name_en: "Speculoos French Toast" }, { id: "unlinked", name_en: "Brioche" }] },
    );
    expect(findings.some((row) => row.code === "duplicate_nac_code")).toBe(true);
    expect(findings.some((row) => row.code === "missing_nac_identity" && row.itemId === "unlinked")).toBe(true);
    expect(findings.some((row) => row.itemId === "toast-a" && row.code === "missing_nac_identity")).toBe(false);
  });

  test("the migration keeps Foodics read-only and does not write the guest menu", () => {
    expect(migration).toContain("NAC-PR");
    expect(migration).toContain("unique (foodics_entity_type, foodics_record_id)");
    expect(migration).not.toMatch(/update\s+public\.menu_items/i);
    expect(migration).not.toMatch(/foodics_sales_items/i);
    expect(migration).toContain("revoke all on function public.allocate_nac_identity");
  });
});
