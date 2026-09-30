/** Client deadline so a hung REST call cannot pin a loading flag. */
export const NAC_FETCH_DEADLINE_MS = 12000;

/**
 * Invoice photos and OCR are not interactive REST calls.
 * A 12s abort is what Safari reports as "Fetch is aborted" during storage upload.
 */
export const NAC_INVOICE_TRANSFER_DEADLINE_MS = 180000;

export function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return "";
}

/**
 * GoTrue refreshes inside the auth lock and, on a retryable fetch failure,
 * keeps retrying for up to its 30s tick. Aborting that call at 12s is a
 * retryable failure, so the lock stays busy and the categories REST call
 * never starts. Leave the refresh attempt on the network. Caller cancellation
 * still applies.
 */
export function isRefreshTokenRequest(input) {
  const url = requestUrl(input);
  return url.includes("/auth/v1/token") && url.includes("grant_type=refresh_token");
}

function requestMethod(input, init = {}) {
  return String(init.method || input?.method || "GET").toUpperCase();
}

/** Storage object writes. Signed-URL reads stay on the short deadline. */
export function isStorageUploadRequest(input, init = {}) {
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  if (method !== "POST" && method !== "PUT") return false;
  return url.includes("/storage/v1/object/") || url.includes("/storage/v1/upload/resumable");
}

/** Vision extraction regularly outlives the interactive REST deadline. */
export function isInvoiceOcrRequest(input, init = {}) {
  const method = requestMethod(input, init);
  if (method !== "POST") return false;
  return requestUrl(input).includes("/functions/v1/inventory-invoice-ocr");
}

export function deadlineForRequest(input, init = {}, timeoutMs = NAC_FETCH_DEADLINE_MS) {
  if (isRefreshTokenRequest(input)) return null;
  if (isStorageUploadRequest(input, init) || isInvoiceOcrRequest(input, init)) {
    return NAC_INVOICE_TRANSFER_DEADLINE_MS;
  }
  return timeoutMs;
}

export function fetchWithDeadline(input, init = {}, timeoutMs = NAC_FETCH_DEADLINE_MS) {
  const deadlineMs = deadlineForRequest(input, init, timeoutMs);
  if (deadlineMs == null) {
    return fetch(input, init);
  }
  const outer = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = outer
    ? setTimeout(() => outer.abort(), deadlineMs)
    : null;
  if (outer && init.signal) {
    if (init.signal.aborted) outer.abort();
    else init.signal.addEventListener("abort", () => outer.abort(), { once: true });
  }
  return fetch(input, outer ? { ...init, signal: outer.signal } : init).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Settles even when fetch abort or the auth lock never rejects. */
export function withDeadline(promise, timeoutMs, message = "Timed out") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
