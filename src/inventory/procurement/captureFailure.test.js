import {
  invoiceCaptureFailureMessage,
  invoiceNeedsExtraction,
  storageObjectAlreadyExists,
} from "./captureFailure";

describe("invoice capture failures", () => {
  test("turns Safari's fetch abort into a stage-specific retry message", () => {
    const aborted = new Error("Fetch is aborted");
    expect(invoiceCaptureFailureMessage("upload", aborted)).toBe(
      "Invoice photo could not be uploaded. Your photo is still selected — tap Retry.",
    );
    expect(invoiceCaptureFailureMessage("extract", aborted)).toMatch(/extraction did not finish/);
    expect(invoiceCaptureFailureMessage("register", aborted)).toMatch(/second invoice will not be created/);
    expect(invoiceCaptureFailureMessage("upload", aborted)).not.toMatch(/Fetch is aborted/);
  });

  test("does not start a second extraction when one is already running or finished", () => {
    expect(invoiceNeedsExtraction({ status: "uploaded", ocr_status: "pending" })).toBe(true);
    expect(invoiceNeedsExtraction({ status: "ocr_failed", ocr_status: "failed" })).toBe(true);
    expect(invoiceNeedsExtraction({ status: "ocr_processing", ocr_status: "processing" })).toBe(false);
    expect(invoiceNeedsExtraction({ status: "needs_review", ocr_status: "completed" })).toBe(false);
    expect(storageObjectAlreadyExists({ message: "The resource already exists", statusCode: "409" })).toBe(true);
    expect(storageObjectAlreadyExists({ message: "Fetch is aborted" })).toBe(false);
  });
});
