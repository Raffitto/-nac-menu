/**
 * One invoice document. A single photo or PDF is uploaded unchanged.
 * Several photos become one PDF before upload.
 * HEIC is rejected until a tested conversion exists.
 */

export function classifyInvoiceFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif" || /\.hei[cf]$/.test(name)) {
    return {
      ok: false,
      reason: "This photo is HEIC. iPhone can save it as JPEG, or choose a JPEG, PNG, WebP, or PDF. HEIC is not sent to OCR.",
    };
  }
  if (type === "application/pdf" || name.endsWith(".pdf")) return { ok: true, kind: "pdf" };
  if (["image/jpeg", "image/png", "image/webp"].includes(type) || /\.(jpe?g|png|webp)$/.test(name)) {
    return { ok: true, kind: "image" };
  }
  return { ok: false, reason: "Use a JPEG, PNG, WebP, or PDF." };
}

export function groupInvoicePages(files = []) {
  const pages = [];
  for (const file of files) {
    const kind = classifyInvoiceFile(file);
    if (!kind.ok) return { ok: false, reason: kind.reason, pages: [] };
    pages.push({ file, kind: kind.kind, pageNumber: pages.length + 1, name: file.name || `page-${pages.length + 1}` });
  }
  if (!pages.length) return { ok: false, reason: "Add at least one page.", pages: [] };
  const pdfs = pages.filter((page) => page.kind === "pdf");
  if (pdfs.length && pages.length > 1) {
    return { ok: false, reason: "A PDF is already one invoice. Do not add extra photos to it.", pages: [] };
  }
  return { ok: true, reason: null, pages, pageCount: pages.length };
}

export function lineReviewState(line = {}) {
  const qty = line.original_quantity ?? line.quantity;
  const price = line.unit_price ?? line.line_total ?? line.lineTotal;
  const unit = line.original_unit || line.unit;
  if (qty == null || qty === "" || price == null || price === "" || !unit) {
    return { tone: "missing", label: "MISSING INFORMATION" };
  }
  if (line.review_status === "ignored") return { tone: "blocked", label: "BLOCKED" };
  if (["verified", "auto_matched"].includes(line.review_status) && line.ingredient_id) {
    return { tone: "recognized", label: "RECOGNIZED" };
  }
  if (!line.ingredient_id) return { tone: "new", label: "NEW ITEM" };
  return { tone: "confirm", label: "CONFIRM MATCH" };
}

const KITCHEN_BLOCKED = new Set(["bar"]);
const BAR_BLOCKED = new Set(["kitchen", "pastry"]);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that page."));
    reader.readAsDataURL(file);
  });
}

export async function buildInvoiceDocument(files = []) {
  const grouped = groupInvoicePages(files);
  if (!grouped.ok) throw new Error(grouped.reason);
  if (grouped.pages.length === 1) return grouped.pages[0].file;
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  for (let index = 0; index < grouped.pages.length; index += 1) {
    if (index > 0) pdf.addPage();
    const page = grouped.pages[index];
    const dataUrl = await readAsDataUrl(page.file);
    const format = String(page.name).toLowerCase().endsWith(".png") ? "PNG" : "JPEG";
    pdf.addImage(dataUrl, format, 24, 24, 547, 760);
  }
  const blob = pdf.output("blob");
  return new File([blob], "invoice-pages.pdf", { type: "application/pdf" });
}

export function receivingLocationAllowed(role, locationType) {
  if (role === "kitchen_inventory_manager") return !KITCHEN_BLOCKED.has(locationType);
  if (role === "bar_inventory_manager") return !BAR_BLOCKED.has(locationType);
  return true;
}
