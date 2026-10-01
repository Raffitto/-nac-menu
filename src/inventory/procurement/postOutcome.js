const AMBIGUOUS = /abort|timeout|timed out|network|failed to fetch|load failed|fetch is aborted/i;

export function isAmbiguousPostError(error) {
  const message = String(error?.message || error || "");
  return AMBIGUOUS.test(message) || error?.name === "AbortError";
}

/**
 * Decide the button state after Approve & post.
 * A receipt found after an unclear response is posted. A definite rejection can be retried.
 */
export function classifyPostOutcome({ error = null, result = null, invoiceAfter = undefined } = {}) {
  const posted = Boolean(
    result?.status === "posted"
    || result?.status === "already_posted"
    || invoiceAfter?.status === "posted"
    || invoiceAfter?.posted_receipt_id
    || invoiceAfter?.postedReceiptId
  );
  if (posted) {
    return { state: "posted", retry: false, message: "Posted. This document already has one receipt." };
  }
  if (!error && result) {
    return { state: "rejected", retry: true, message: "The receipt was not created. Refresh this document before trying again." };
  }
  if (isAmbiguousPostError(error)) {
    if (invoiceAfter === undefined || invoiceAfter === null) {
      return {
        state: "uncertain",
        retry: false,
        message: "Posting status could not be confirmed. Refresh status before trying again.",
      };
    }
    return {
      state: "rejected",
      retry: true,
      message: `${error?.message || "The request did not finish."} No receipt was created.`,
    };
  }
  return {
    state: "rejected",
    retry: true,
    message: error?.message || "The receipt was not created.",
  };
}

export function humanizePostError(message = "") {
  if (/receiving location/i.test(message)) {
    return "Choose where this delivery was received, then save it. No receipt was created.";
  }
  return message;
}
