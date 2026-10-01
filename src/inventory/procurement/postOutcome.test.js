import { classifyPostOutcome, humanizePostError } from "./postOutcome";

describe("approve and post outcomes", () => {
  test("a successful or existing receipt is posted and cannot be retried", () => {
    expect(classifyPostOutcome({ result: { status: "posted" } })).toMatchObject({ state: "posted", retry: false });
    expect(classifyPostOutcome({
      error: new Error("timeout"),
      invoiceAfter: { status: "posted", posted_receipt_id: "r1" },
    }).state).toBe("posted");
    expect(classifyPostOutcome({ result: { status: "already_posted" } }).retry).toBe(false);
  });

  test("a definite rejection stays visible and can be retried", () => {
    const outcome = classifyPostOutcome({
      error: new Error("Approve and post invoice: No receiving location configured for branch khobar"),
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.retry).toBe(true);
    expect(humanizePostError(outcome.message)).toMatch(/No receipt was created/);
  });

  test("an unclear failure with no confirmed invoice stays blocked", () => {
    const outcome = classifyPostOutcome({ error: new Error("Fetch is aborted"), invoiceAfter: null });
    expect(outcome.state).toBe("uncertain");
    expect(outcome.retry).toBe(false);
    expect(outcome.message).toMatch(/could not be confirmed/);
  });

  test("an unclear failure with a still-unposted invoice can be retried", () => {
    const outcome = classifyPostOutcome({
      error: new Error("network"),
      invoiceAfter: { status: "needs_review", posted_receipt_id: null },
    });
    expect(outcome.state).toBe("rejected");
    expect(outcome.retry).toBe(true);
  });
});
