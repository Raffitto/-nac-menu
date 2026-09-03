import {
  classifyDrivePath,
  shouldIngestDiscoveryDecision,
  buildDiscoverySummary,
} from "./driveDiscoveryClassifier";
import {
  isDriveDiscoveryApprovalCommand,
  parseDriveDiscoveryApprovalCommand,
} from "./driveDiscoveryApprovalParser";
import { routeAskNacIntent, ASK_NAC_INTENTS } from "../../intentRouter";

describe("driveDiscoveryClassifier", () => {
  test("classifies known Daily folders with ingest/ignore/ask actions", () => {
    expect(classifyDrivePath("Daily/Cash Up", "Cash up 2026.xlsx").detectedReportType).toBe("cash_up");
    expect(classifyDrivePath("Daily/Voids discounts", "June voids.xlsx").detectedReportType).toBe("discount_void_comp");
    expect(classifyDrivePath("Daily/Daily Napkins Count", "napkins.xlsx").recommendedAction).toBe("ignore");
    expect(classifyDrivePath("Daily/Guest Feedback", "feedback.docx").recommendedAction).toBe("ask");
    expect(classifyDrivePath("Weekly/Executive Reports/Weekly Dashboards", "dash.xlsx").detectedReportType).toBe("weekly_dashboard");
    expect(classifyDrivePath("Daily", " 2026 review tracking.xlsx").detectedReportType).toBe("google_review_tracking");
    expect(shouldIngestDiscoveryDecision(classifyDrivePath("Daily", " 2026 review tracking.xlsx"))).toBe(true);
  });

  test("unknown folders require approval", () => {
    const decision = classifyDrivePath("Daily/New Mystery Folder", "file.xlsx");
    expect(decision.detectedReportType).toBe("unknown_needs_review");
    expect(decision.needsApproval).toBe(true);
    expect(shouldIngestDiscoveryDecision(decision)).toBe(false);
  });

  test("approved ingest folders pass gate", () => {
    const decision = classifyDrivePath("Daily/Breakage", "breakage.xlsx");
    expect(shouldIngestDiscoveryDecision(decision)).toBe(true);
  });
});

describe("driveDiscoveryApprovalParser", () => {
  test("parses natural-language approvals", () => {
    const parsed = parseDriveDiscoveryApprovalCommand("ingest Cash Up and Logbook");
    expect(parsed.decisions).toHaveLength(2);
    expect(parsed.decisions.every((row) => row.action === "ingest")).toBe(true);
  });

  test("maps voids discounts to discount_void_comp", () => {
    const parsed = parseDriveDiscoveryApprovalCommand("treat Voids discounts as discount_void_comp");
    expect(parsed.decisions[0].detectedReportType).toBe("discount_void_comp");
  });

  test("routes discover and approve commands in Ask NAC", () => {
    expect(routeAskNacIntent("discover Drive folders", { branch: "khobar" }).intent).toBe(
      ASK_NAC_INTENTS.VAULT_DRIVE_DISCOVER,
    );
    expect(isDriveDiscoveryApprovalCommand("ignore Daily Napkins Count")).toBe(true);
    expect(routeAskNacIntent("ignore Daily Napkins Count", { branch: "khobar" }).intent).toBe(
      ASK_NAC_INTENTS.VAULT_DRIVE_APPROVE_RULES,
    );
  });
});

describe("buildDiscoverySummary", () => {
  test("counts approval buckets", () => {
    const summary = buildDiscoverySummary([
      { recommendedAction: "ingest", needsApproval: false, detectedReportType: "cash_up" },
      { recommendedAction: "ignore", needsApproval: false, detectedReportType: "ignore" },
      { recommendedAction: "ask", needsApproval: true, detectedReportType: "guest_feedback" },
    ]);
    expect(summary.approvedIngestCount).toBe(1);
    expect(summary.ignoredCount).toBe(1);
    expect(summary.askCount).toBe(1);
    expect(summary.needsApprovalCount).toBe(1);
  });
});
