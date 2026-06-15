/**
 * Content hashing for vault duplicate detection.
 */

export async function computeFileContentHash(file) {
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeBufferContentHash(buffer) {
  if (!buffer) return null;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hex digest for chunk deduplication. */
export async function computeTextContentHash(text) {
  const value = String(text || "");
  if (!value) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
