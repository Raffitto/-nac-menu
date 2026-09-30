/**
 * Manager-facing invoice capture failures.
 * Raw fetch aborts stay in the console; the screen names the stage and keeps the photo.
 */

export function invoiceCaptureFailureMessage(stage, cause) {
  const raw = String(cause?.message || cause || "");
  if (stage === "prepare") {
    return "The photo could not be prepared. It is still selected — tap Retry.";
  }
  if (stage === "upload") {
    return "Invoice photo could not be uploaded. Your photo is still selected — tap Retry.";
  }
  if (stage === "register") {
    return "The photo reached storage, but the invoice was not saved. Tap Retry. A second invoice will not be created.";
  }
  if (stage === "extract") {
    return "The invoice was saved, but extraction did not finish. Tap Retry to extract it again without uploading a second copy.";
  }
  if (stage === "auth") {
    return "Your sign-in could not be confirmed. Your photo is still selected — tap Retry.";
  }
  return raw || "The invoice photo could not be sent. It is still selected — tap Retry.";
}

export function invoiceCaptureError(stage, cause) {
  const error = new Error(invoiceCaptureFailureMessage(stage, cause));
  error.stage = stage;
  error.cause = cause;
  return error;
}

export function uploadStageLabel(stage) {
  switch (stage) {
    case "preparing":
      return "Preparing photo…";
    case "uploading":
      return "Uploading source…";
    case "registering":
      return "Saving invoice…";
    case "extracting":
      return "Extracting…";
    case "review":
      return "Loading review…";
    default:
      return "Working…";
  }
}

export function invoiceNeedsExtraction(invoice) {
  if (!invoice) return true;
  if (invoice.ocr_status === "completed" || invoice.ocr_status === "processing") return false;
  if (["extracted", "needs_review", "posted", "approved", "rejected", "completed"].includes(invoice.status)) {
    return false;
  }
  return true;
}

export function storageObjectAlreadyExists(error) {
  const message = String(error?.message || "").toLowerCase();
  const status = String(error?.statusCode || error?.status || "");
  return status === "409" || message.includes("already exists");
}
