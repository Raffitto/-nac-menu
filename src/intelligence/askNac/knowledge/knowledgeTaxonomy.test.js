import {
  mapReportTypeToKnowledge,
  classifyKnowledgeFromContent,
  resolveKnowledgeTaxonomy,
  assessDomainReadinessPlaceholders,
  METRIC_CATALOG,
  KNOWLEDGE_DOMAINS,
} from "./knowledgeTaxonomy";
import { classifyVaultUpload } from "../vault/vaultAutoClassifier";

describe("knowledgeTaxonomy", () => {
  test("maps existing operational report types to knowledge domains", () => {
    expect(mapReportTypeToKnowledge("cash_up")).toMatchObject({
      domain: "operations",
      artifactType: "report",
      authority: "uploaded_report",
    });
    expect(mapReportTypeToKnowledge("daily_logbook").domain).toBe("operations");
    expect(mapReportTypeToKnowledge("pnl").domain).toBe("finance");
    expect(mapReportTypeToKnowledge("brand_brain_sop")).toMatchObject({
      domain: "brand",
      subdomain: "brand.sop",
      authority: "branch_sop",
    });
    expect(mapReportTypeToKnowledge("weekly_dashboard").domain).toBe("executive");
  });

  test("exposes canonical metric catalog keys", () => {
    expect(METRIC_CATALOG.cash_up).toEqual(expect.arrayContaining(["net_sales", "gross_sales", "guest_count"]));
    expect(METRIC_CATALOG.food_safety).toEqual(expect.arrayContaining(["temperature", "audit_score"]));
    expect(METRIC_CATALOG.waste).toEqual(expect.arrayContaining(["item", "total_loss"]));
    expect(METRIC_CATALOG.procurement).toEqual(expect.arrayContaining(["supplier", "invoice_number"]));
  });

  test("classifies HACCP content as food_safety.haccp", () => {
    const result = classifyKnowledgeFromContent("Khobar HACCP Manual 2026.pdf");
    expect(result.knowledgeDomain).toBe("food_safety");
    expect(result.knowledgeSubdomain).toBe("food_safety.haccp");
    expect(result.detectedReportType).toBe("food_safety_haccp");
  });

  test("classifies reheating logs as food_safety.temperature", () => {
    const result = classifyKnowledgeFromContent("Reheating log hot holding.pdf");
    expect(result.knowledgeSubdomain).toBe("food_safety.temperature");
    expect(result.detectedReportType).toBe("food_safety_temperature");
  });

  test("classifies temperature logs as food_safety.temperature", () => {
    const result = classifyKnowledgeFromContent("Daily temperature log June.xlsx");
    expect(result.knowledgeSubdomain).toBe("food_safety.temperature");
    expect(result.detectedReportType).toBe("food_safety_temperature");
  });

  test("classifies receiving checklist as food_safety.receiving", () => {
    const result = classifyKnowledgeFromContent("Receiving checklist supplier delivery.docx");
    expect(result.knowledgeSubdomain).toBe("food_safety.receiving");
    expect(result.detectedReportType).toBe("food_safety_receiving");
  });

  test("classifies supplier evaluation as procurement.supplier", () => {
    const result = classifyKnowledgeFromContent("Supplier evaluation form 2026.xlsx");
    expect(result.knowledgeDomain).toBe("procurement");
    expect(result.knowledgeSubdomain).toBe("procurement.supplier");
    expect(result.detectedReportType).toBe("supplier_evaluation");
  });

  test("classifies waste/spoilage under operations waste.spoilage subdomain", () => {
    const spoilage = classifyKnowledgeFromContent("Kitchen spoilage report May.xlsx");
    expect(spoilage.knowledgeDomain).toBe("operations");
    expect(spoilage.knowledgeSubdomain).toBe("waste.spoilage");
    expect(spoilage.detectedReportType).toBe("waste_report");

    const recycling = classifyKnowledgeFromContent("Recycling log June.pdf");
    expect(recycling.knowledgeSubdomain).toBe("waste.recycling");
  });

  test("routes generic SOP to brand and food-safety hygiene to food_safety", () => {
    const brandSop = resolveKnowledgeTaxonomy({
      filename: "Customer service SOP Khobar.docx",
      reportType: "other",
    });
    expect(brandSop.knowledgeDomain).toBe("brand");
    expect(brandSop.knowledgeSubdomain).toBe("brand.sop");

    const hygiene = resolveKnowledgeTaxonomy({
      filename: "Personal hygiene checklist kitchen.pdf",
      reportType: "other",
    });
    expect(hygiene.knowledgeDomain).toBe("food_safety");
    expect(hygiene.knowledgeSubdomain).toBe("food_safety.cleaning");
  });

  test("domain readiness placeholders score operations only in production", () => {
    const readiness = assessDomainReadinessPlaceholders({
      fileInventory: { food_safety_haccp: 2, cash_up: 5 },
    });
    const ops = readiness.find((r) => r.domain === "operations");
    const foodSafety = readiness.find((r) => r.domain === "food_safety");
    expect(ops.productionScored).toBe(true);
    expect(ops.status).toBe("production_scored");
    expect(foodSafety.productionScored).toBe(false);
    expect(foodSafety.status).toBe("stored_only");
    expect(foodSafety.storedFileCount).toBe(2);
  });

  test("all knowledge domains are enumerated", () => {
    expect(KNOWLEDGE_DOMAINS).toEqual(expect.arrayContaining([
      "executive", "operations", "food_safety", "procurement", "culinary", "brand", "finance",
    ]));
  });
});

describe("vaultAutoClassifier knowledge integration", () => {
  test("HACCP vault upload classifies as food_safety.haccp", () => {
    const result = classifyVaultUpload({ filename: "NAC HACCP Manual.pdf" });
    expect(result.detectedReportType).toBe("food_safety_haccp");
    expect(result.detectedKnowledgeDomain).toBe("food_safety");
    expect(result.detectedKnowledgeSubdomain).toBe("food_safety.haccp");
  });

  test("cash_up and logbook routing unchanged", () => {
    const cashUp = classifyVaultUpload({ filename: "Khobar cash up June 14.xlsx" });
    expect(cashUp.detectedReportType).toBe("cash_up");
    expect(cashUp.detectedKnowledgeDomain).toBe("operations");

    const logbook = classifyVaultUpload({ filename: "14_June_NAC_Khobar_Logbook.docx.pdf" });
    expect(logbook.detectedReportType).toBe("daily_logbook");
    expect(logbook.detectedKnowledgeDomain).toBe("operations");
  });
});
