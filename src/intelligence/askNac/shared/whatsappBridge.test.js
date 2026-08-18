const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "../../../..");
const comms = require(path.join(root, "ai-control/comms"));

const TEST_CONTROLLER = "+966500000001";
const UNKNOWN_SENDER = "+966500000099";
const allowlistConfig = { allowlistE164: [TEST_CONTROLLER] };

describe("WhatsApp engineering control bridge", () => {
  test("controller allowlist permits configured controller", () => {
    const result = comms.evaluateController(TEST_CONTROLLER, allowlistConfig);
    expect(result.allowed).toBe(true);
    expect(result.senderRedacted).toMatch(/^\+966…/);
  });

  test("unknown sender is rejected deterministically", () => {
    const result = comms.evaluateController(UNKNOWN_SENDER, allowlistConfig);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(comms.REJECTION_REASONS.NOT_ALLOWLISTED);

    const normalized = comms.normalizeInboundMessage(
      { from: UNKNOWN_SENDER, body: "status" },
      allowlistConfig,
    );
    expect(normalized.accepted).toBe(false);
    expect(normalized.safeForGitHub).toBe(false);
  });

  test("normalizes text question", () => {
    const normalized = comms.normalizeInboundMessage(
      { from: TEST_CONTROLLER, body: "What is the active task?" },
      allowlistConfig,
    );
    expect(normalized.eventType).toBe(comms.CONTROL_EVENT_TYPES.QUESTION);
    expect(normalized.permissionClass).toBe("AUTO");
    expect(normalized.safeForGitHub).toBe(true);
  });

  test("normalizes approve and reject commands as ASK_RAFFI", () => {
    const approve = comms.normalizeInboundMessage(
      { from: TEST_CONTROLLER, body: "approve NAC-COMMS-0001" },
      allowlistConfig,
    );
    expect(approve.eventType).toBe(comms.CONTROL_EVENT_TYPES.APPROVAL);
    expect(approve.permissionClass).toBe("ASK_RAFFI");
    expect(approve.safeForGitHub).toBe(false);

    const reject = comms.normalizeInboundMessage(
      { from: TEST_CONTROLLER, body: "reject NAC-COMMS-0001" },
      allowlistConfig,
    );
    expect(reject.eventType).toBe(comms.CONTROL_EVENT_TYPES.REJECTION);
    expect(reject.permissionClass).toBe("ASK_RAFFI");
  });

  test("normalizes change request and status request", () => {
    const change = comms.normalizeInboundMessage(
      { from: TEST_CONTROLLER, body: "change the handoff format" },
      allowlistConfig,
    );
    expect(change.eventType).toBe(comms.CONTROL_EVENT_TYPES.CHANGE_REQUEST);

    const status = comms.normalizeInboundMessage(
      { from: TEST_CONTROLLER, body: "status" },
      allowlistConfig,
    );
    expect(status.eventType).toBe(comms.CONTROL_EVENT_TYPES.STATUS_REQUEST);
  });

  test("attachment metadata normalized without local path in GitHub artifact", () => {
    const normalized = comms.normalizeInboundMessage(
      {
        from: TEST_CONTROLLER,
        hasMedia: true,
        mimetype: "image/jpeg",
        filename: "screenshot.png",
        byteLength: 4096,
        localPath: "/tmp/secret-session/wa/media.jpg",
      },
      allowlistConfig,
    );
    expect(normalized.eventType).toBe(comms.CONTROL_EVENT_TYPES.ATTACHMENT);
    expect(normalized.payload.attachment.filename).toBe("screenshot.png");

    const gh = comms.buildGitHubControlArtifact(normalized, {
      controlRoomIssue: 2,
      repoRoot: root,
    });
    expect(gh.permissionGate).toBe("AUTO");
    expect(gh.artifact.containsSessionMaterial).toBe(false);
    expect(JSON.stringify(gh.artifact)).not.toMatch(/secret-session/);
    expect(JSON.stringify(gh.artifact)).not.toMatch(/localPath/);
  });

  test("permission gate preserved — ASK_RAFFI records pending decision, not auto execute", () => {
    const normalized = comms.normalizeInboundMessage(
      { from: TEST_CONTROLLER, body: "approve NAC-TEST-0001" },
      allowlistConfig,
    );
    const gh = comms.buildGitHubControlArtifact(normalized, { repoRoot: root });
    expect(gh.action).toBe("record_pending_decision");
    expect(gh.permissionGate).toBe("ASK_RAFFI");
    expect(gh.commentBody).toMatch(/ASK_RAFFI/);
    expect(gh.commentBody).toMatch(/not auto-executed/i);
  });

  test("AUTO events produce control artifact without secrets", () => {
    const normalized = comms.normalizeInboundMessage(
      { from: TEST_CONTROLLER, body: "status" },
      allowlistConfig,
    );
    const gh = comms.buildGitHubControlArtifact(normalized, { repoRoot: root });
    expect(gh.action).toBe("upsert_control_artifact");
    expect(gh.artifactPath).toBe("ai-control/comms/inbound-events.jsonl");
    const serialized = JSON.stringify(gh.artifact);
    expect(serialized).not.toMatch(/LocalAuth/);
    expect(serialized).not.toMatch(/WABrowserId/);
    expect(gh.artifact.containsSessionMaterial).toBe(false);
  });

  test("outbound daily handoff summary formatting", () => {
    const payload = comms.formatDailyHandoffSummary({
      taskId: "NAC-COMMS-0001",
      result: "PASS_WITH_HOSTING_BLOCKER",
      branch: "release/ask-nac-fabric-founding-day",
      tests: "whatsappBridge|aiControlProtocol PASS",
      nextStep: "awaiting_review",
    });
    expect(payload.messageType).toBe("daily_handoff_summary");
    expect(payload.text).toMatch(/NAC Engineering/);
    expect(payload.text).toMatch(/NAC-COMMS-0001/);
    expect(payload.metadata.containsSecrets).toBe(false);
  });

  test("outbound blocker decision request formatting", () => {
    const payload = comms.formatBlockerDecisionRequest({
      title: "Approve hosting spend?",
      options: ["Use existing hardware", "Defer WhatsApp 24/7"],
      context: "No free persistent host found.",
    });
    expect(payload.messageType).toBe("blocker_decision_request");
    expect(payload.text).toMatch(/approve/);
    expect(payload.text).toMatch(/reject/);
  });

  test("hosting verdict documents laptop-off blocker", () => {
    const eval_ = comms.getHostingEvaluation();
    expect(eval_.verdict.CODE).toBe("FREE_SOFTWARE_PROVEN_LAPTOP_OFF_HOSTING_BLOCKED");
    expect(eval_.freePersistentHostFound).toBe(false);
    expect(eval_.verdict.recurringCost).toBe(0);
  });

  test("oss evaluation recommends whatsapp-web.js with Apache-2.0", () => {
    const oss = JSON.parse(
      fs.readFileSync(path.join(root, "ai-control/comms/ossEvaluation.json"), "utf8"),
    );
    expect(oss.recommended.package).toBe("whatsapp-web.js");
    expect(oss.recommended.version).toBe("1.34.7");
    expect(oss.licenseAcceptableForCommercial).toBe(true);
    expect(oss.recurringCost).toBe(0);
  });

  test("no session material in comms module persisted outputs", () => {
    const commsDir = path.join(root, "ai-control/comms");
    const files = fs.readdirSync(commsDir).filter((f) => f.endsWith(".js") || f.endsWith(".json"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(commsDir, file), "utf8");
      expect(content).not.toMatch(/WABrowserId/);
      expect(content).not.toMatch(/LocalAuth\.data/);
    }
  });
});

describe("NAC AI control protocol (comms task)", () => {
  test("STATE.json reflects NAC-COMMS-0001 in protocol", () => {
    const state = JSON.parse(fs.readFileSync(path.join(root, "ai-control/STATE.json"), "utf8"));
    expect(state.protocolVersion).toBe(1);
    const commsTracked =
      state.activeTaskId === "NAC-COMMS-0001" || state.lastCompletedTaskId === "NAC-COMMS-0001";
    expect(commsTracked).toBe(true);
    expect(state.budgetPolicy.onDemandAllowed).toBe(false);
  });

  test("NEXT_TASK.md carries NAC-COMMS taskId and deploy none", () => {
    const md = fs.readFileSync(path.join(root, "ai-control/NEXT_TASK.md"), "utf8");
    expect(md).toMatch(/taskId:\s*NAC-COMMS-0001/);
    expect(md).toMatch(/deploy:\s*none/);
    expect(md).toMatch(/mergeToMain:\s*false/);
  });
});
