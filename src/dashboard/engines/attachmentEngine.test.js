import { buildAttachmentIntelligence } from "./attachmentEngine";
import { formatAttachmentOpportunityBody } from "./attachmentOpportunityCopy";

describe("buildAttachmentIntelligence", () => {
  it("counts protein add-ons from menu rows and never reports 0% when add-ons sold", () => {
    const salesItems = [
      { raw_item_name: "Rigatoni Pink Sauce", quantity_sold: 1000, semantic_class: "menu" },
      { raw_item_name: "Corn & White Truffle Risotto", quantity_sold: 495, semantic_class: "menu" },
      { raw_item_name: "Sumac Chicken", quantity_sold: 300, semantic_class: "menu" },
      { raw_item_name: "Smoked Paprika Prawn", quantity_sold: 249, semantic_class: "menu" },
    ];

    const { pairs } = buildAttachmentIntelligence({ salesItems });
    const protein = pairs.find((p) => p.id === "protein_pasta_risotto");
    expect(protein.parentOrders).toBe(1495);
    expect(protein.attachedOrders).toBe(549);
    expect(protein.attachmentRate).toBeGreaterThan(0);
    expect(formatAttachmentOpportunityBody(protein)).toMatch(/549 protein add-ons/);
    expect(formatAttachmentOpportunityBody(protein)).not.toMatch(/0% attach/);
  });

  it("flags fries basket validation when fries exceed burger parents", () => {
    const salesItems = [
      { raw_item_name: "The Big Nac Burger", quantity_sold: 400, semantic_class: "menu" },
      { raw_item_name: "Angus Steak", quantity_sold: 387, semantic_class: "menu" },
      { raw_item_name: "Halloumi Fries", quantity_sold: 943, semantic_class: "menu" },
    ];

    const { pairs } = buildAttachmentIntelligence({ salesItems });
    const fries = pairs.find((p) => p.id === "fries_burger");
    expect(fries.parentOrders).toBe(787);
    expect(fries.attachedOrders).toBe(943);
    expect(fries.requiresBasketValidation).toBe(true);
    expect(fries.estimatedLostRevenue).toBe(0);
    expect(formatAttachmentOpportunityBody(fries)).toMatch(/validate basket-level pairing/i);
  });
});
