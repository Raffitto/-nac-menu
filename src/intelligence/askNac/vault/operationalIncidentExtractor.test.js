import { buildIncidentRegister, extractIncidentsFromNarrative } from "./operationalIncidentExtractor";

const SECTION_LABELS = {
  dinner_notes: "Dinner",
  breakfast_notes: "Breakfast",
  lunch_notes: "Lunch",
};

function narrative(date, text) {
  return {
    periodStart: date,
    metricKey: "dinner_notes",
    fileTitle: `${date} logbook`,
    dimensions: { text_value: text, provenance: "historical_docx_recovery" },
  };
}

const OCTOBER_FACTS = [
  narrative(
    "2026-10-01",
    "Table 21 complained about quinoa salad tasting different. Management tasted it, offered another salad, and removed the original item from the bill. Table 10 became upset about the popcorn chicken service sequence. Staff offered popcorn chicken as recovery.",
  ),
  narrative(
    "2026-10-07",
    "Table 21 complained about Black Angus steak taste and spicy sauce. A replacement was offered and refused. The steak was removed from the bill.",
  ),
  narrative(
    "2026-10-12",
    "The dining room was steady. No guest complained. Pest control checked the traps after service.",
  ),
  narrative(
    "2026-10-13",
    "Table 10 complained about French toast tasting different. Another dessert was offered and refused. The item was removed from the bill.",
  ),
];

describe("operational incident extraction", () => {
  test("splits one dinner narrative into two complaints", () => {
    const incidents = extractIncidentsFromNarrative(OCTOBER_FACTS[0].dimensions.text_value, {
      date: "2026-10-01",
      servicePeriod: "Dinner",
      sourceDocument: "2026-10-01 logbook",
    }).filter((item) => item.kind === "complaint");
    expect(incidents).toHaveLength(2);
    expect(incidents[0]).toMatchObject({
      tableNumber: "21",
      product: "Quinoa Salad",
      category: "food_quality",
    });
    expect(incidents[0].action).toMatch(/Replacement offered/i);
    expect(incidents[0].action).toMatch(/removed from bill/i);
    expect(incidents[0].resolution).toMatch(/not documented/i);
    expect(incidents[0].satisfactionKnown).toBe(false);
    expect(incidents[1]).toMatchObject({ tableNumber: "10", product: "Popcorn Chicken", category: "service" });
    expect(incidents[1].action).toMatch(/offered as recovery/i);
  });

  test("does not turn a negated sentence or pest control into a guest complaint", () => {
    const incidents = extractIncidentsFromNarrative(OCTOBER_FACTS[2].dimensions.text_value, {
      date: "2026-10-12",
      servicePeriod: "Dinner",
    });
    expect(incidents.filter((item) => item.kind === "complaint")).toHaveLength(0);
    expect(incidents.filter((item) => item.kind === "maintenance")).toHaveLength(1);
    expect(incidents[0].evidenceExcerpt).toMatch(/pest control/i);
  });

  test("records refusal and bill removal without inventing satisfaction", () => {
    const [incident] = extractIncidentsFromNarrative(OCTOBER_FACTS[1].dimensions.text_value, {
      date: "2026-10-07",
      servicePeriod: "Dinner",
      sourceDocument: "2026-10-07 logbook",
    });
    expect(incident.product).toBe("Black Angus Steak");
    expect(incident.action).toMatch(/declined/i);
    expect(incident.action).toMatch(/removed from bill/i);
    expect(incident.resolution).toBe("Final satisfaction not documented.");
    expect(incident.sourceDocument).toBe("2026-10-07 logbook");
    expect(incident.sourceSection).toBe("Dinner");
  });

  test("October register has four complaints, distinct dates, and no duplicate rows", () => {
    const register = buildIncidentRegister({
      facts: OCTOBER_FACTS,
      branchLabel: "Khobar",
      periodLabel: "1–14 October 2026",
      mode: "complaints",
      textKeys: ["dinner_notes"],
      sectionLabels: SECTION_LABELS,
    });
    expect(register.operationalFindings).toHaveLength(4);
    expect(register.directAnswer).toMatch(/4 documented items identified/i);
    expect(register.directAnswer).toMatch(/Quinoa Salad/);
    expect(register.directAnswer).toMatch(/Popcorn Chicken/);
    expect(register.directAnswer).toMatch(/Black Angus Steak/);
    expect(register.directAnswer).toMatch(/French Toast/);
    expect(register.directAnswer).not.toMatch(/No guest complained/i);
    expect(register.directAnswer).not.toMatch(/pest control/i);
    const keys = register.operationalFindings.map((item) => `${item.date}|${item.tableNumber}|${item.product}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(register.insights.join(" ")).not.toMatch(/quinoa salad tasting different\. Management tasted/i);
    expect(register.recommendations.join(" ")).toMatch(/satisfaction|bill removal/i);
    expect(register.keyMetrics.find((metric) => metric.label === "Documented incidents").value).toBe("4");
  });

  test("recurring taste notes stay separate incidents", () => {
    const register = buildIncidentRegister({
      facts: OCTOBER_FACTS,
      branchLabel: "Khobar",
      periodLabel: "1–14 October 2026",
      mode: "complaints",
      textKeys: ["dinner_notes"],
      sectionLabels: SECTION_LABELS,
    });
    expect(register.directAnswer).toMatch(/recurring/i);
    expect(register.operationalFindings.filter((item) => item.issue.includes("inconsistent taste"))).toHaveLength(2);
  });
});
