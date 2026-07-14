export type InvoiceEvidence = {
  page?: number;
  boundingBox?: number[];
  text?: string;
  field?: string;
};

export type ExtractedInvoiceLine = {
  lineNumber: number;
  pageNumber?: number | null;
  originalDescription: string;
  supplierSku?: string | null;
  quantity?: string | null;
  unit?: string | null;
  packQuantity?: string | null;
  packSize?: string | null;
  packUnit?: string | null;
  unitPrice?: string | null;
  lineDiscount?: string | null;
  taxRate?: string | null;
  taxAmount?: string | null;
  lineTotal?: string | null;
  confidence?: number | null;
  evidence?: InvoiceEvidence[];
};

export type ExtractedInvoice = {
  supplierName?: string | null;
  supplierVatNumber?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  deliveryDate?: string | null;
  purchaseOrderNumber?: string | null;
  currency?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  discount?: string | null;
  total?: string | null;
  rawText: string;
  confidence: number;
  evidence: InvoiceEvidence[];
  lines: ExtractedInvoiceLine[];
};

export type InvoiceExtractionResult = {
  invoice: ExtractedInvoice;
  provider: string;
  modelVersion: string;
  providerMetadata: Record<string, unknown>;
  processedAt: string;
};

export interface InvoiceOcrProvider {
  readonly name: string;
  readonly modelVersion: string;
  extractInvoice(document: {
    bytes: Uint8Array;
    mimeType: string;
    filename: string;
  }): Promise<InvoiceExtractionResult>;
}

const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    supplierName: { type: ["string", "null"] },
    supplierVatNumber: { type: ["string", "null"] },
    invoiceNumber: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"], description: "ISO 8601 date when unambiguous" },
    deliveryDate: { type: ["string", "null"], description: "ISO 8601 date when present" },
    purchaseOrderNumber: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    subtotal: { type: ["string", "null"] },
    tax: { type: ["string", "null"] },
    discount: { type: ["string", "null"] },
    total: { type: ["string", "null"] },
    rawText: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          page: { type: ["integer", "null"] },
          boundingBox: { type: ["array", "null"], items: { type: "number" } },
          text: { type: ["string", "null"] },
          field: { type: ["string", "null"] },
        },
        required: ["page", "boundingBox", "text", "field"],
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          lineNumber: { type: "integer", minimum: 1 },
          pageNumber: { type: ["integer", "null"] },
          originalDescription: { type: "string" },
          supplierSku: { type: ["string", "null"] },
          quantity: { type: ["string", "null"] },
          unit: { type: ["string", "null"] },
          packQuantity: { type: ["string", "null"] },
          packSize: { type: ["string", "null"] },
          packUnit: { type: ["string", "null"] },
          unitPrice: { type: ["string", "null"] },
          lineDiscount: { type: ["string", "null"] },
          taxRate: { type: ["string", "null"] },
          taxAmount: { type: ["string", "null"] },
          lineTotal: { type: ["string", "null"] },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                page: { type: ["integer", "null"] },
                boundingBox: { type: ["array", "null"], items: { type: "number" } },
                text: { type: ["string", "null"] },
                field: { type: ["string", "null"] },
              },
              required: ["page", "boundingBox", "text", "field"],
            },
          },
        },
        required: [
          "lineNumber", "pageNumber", "originalDescription", "supplierSku",
          "quantity", "unit", "packQuantity", "packSize", "packUnit",
          "unitPrice", "lineDiscount", "taxRate", "taxAmount", "lineTotal",
          "confidence", "evidence",
        ],
      },
    },
  },
  required: [
    "supplierName", "supplierVatNumber", "invoiceNumber", "invoiceDate",
    "deliveryDate", "purchaseOrderNumber", "currency", "subtotal", "tax",
    "discount", "total", "rawText", "confidence", "evidence", "lines",
  ],
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
}

function sanitizeDecimal(value: unknown): string | null {
  if (value == null || value === "") return null;
  const normalized = String(value).replace(/,/g, "").trim();
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized) ? normalized : null;
}

function normalizeResult(value: Record<string, any>): ExtractedInvoice {
  return {
    supplierName: value.supplierName || null,
    supplierVatNumber: value.supplierVatNumber || null,
    invoiceNumber: value.invoiceNumber || null,
    invoiceDate: value.invoiceDate || null,
    deliveryDate: value.deliveryDate || null,
    purchaseOrderNumber: value.purchaseOrderNumber || null,
    currency: value.currency ? String(value.currency).toUpperCase() : null,
    subtotal: sanitizeDecimal(value.subtotal),
    tax: sanitizeDecimal(value.tax),
    discount: sanitizeDecimal(value.discount),
    total: sanitizeDecimal(value.total),
    rawText: String(value.rawText || ""),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    lines: (Array.isArray(value.lines) ? value.lines : []).map((line: any, index: number) => ({
      lineNumber: Number(line.lineNumber) || index + 1,
      pageNumber: line.pageNumber == null ? null : Number(line.pageNumber),
      originalDescription: String(line.originalDescription || ""),
      supplierSku: line.supplierSku || null,
      quantity: sanitizeDecimal(line.quantity),
      unit: line.unit || null,
      packQuantity: sanitizeDecimal(line.packQuantity),
      packSize: sanitizeDecimal(line.packSize),
      packUnit: line.packUnit || null,
      unitPrice: sanitizeDecimal(line.unitPrice),
      lineDiscount: sanitizeDecimal(line.lineDiscount),
      taxRate: sanitizeDecimal(line.taxRate),
      taxAmount: sanitizeDecimal(line.taxAmount),
      lineTotal: sanitizeDecimal(line.lineTotal),
      confidence: line.confidence == null ? null : Math.max(0, Math.min(1, Number(line.confidence))),
      evidence: Array.isArray(line.evidence) ? line.evidence : [],
    })),
  };
}

export class OpenAiInvoiceOcrProvider implements InvoiceOcrProvider {
  readonly name = "openai";
  readonly modelVersion: string;
  private readonly apiKey: string;

  constructor(apiKey: string, modelVersion = "gpt-4.1-mini") {
    this.apiKey = apiKey;
    this.modelVersion = modelVersion;
  }

  async extractInvoice(document: {
    bytes: Uint8Array;
    mimeType: string;
    filename: string;
  }): Promise<InvoiceExtractionResult> {
    const fileData = `data:${document.mimeType};base64,${bytesToBase64(document.bytes)}`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelVersion,
        temperature: 0,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Extract this supplier invoice exactly.",
                "Never invent a missing value; return null.",
                "Keep original supplier product wording, including Arabic.",
                "Amounts and quantities must be decimal strings without currency symbols.",
                "Pack quantity means units inside a pack; pack size is the amount per inner unit.",
                "Return all visible text in rawText and evidence coordinates only when available.",
              ].join(" "),
            },
            {
              type: "input_file",
              filename: document.filename,
              file_data: fileData,
            },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "supplier_invoice",
            strict: true,
            schema: INVOICE_SCHEMA,
          },
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(String(payload?.error?.message || `OCR provider failed (${response.status})`).slice(0, 500));
    }
    const outputText = payload.output_text ||
      payload.output?.flatMap((item: any) => item.content || [])
        .find((item: any) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("OCR provider returned no structured output");
    const parsed = normalizeResult(JSON.parse(outputText));
    return {
      invoice: parsed,
      provider: this.name,
      modelVersion: this.modelVersion,
      providerMetadata: {
        responseId: payload.id || null,
        usage: payload.usage || null,
      },
      processedAt: new Date().toISOString(),
    };
  }
}

export function createInvoiceOcrProvider(): InvoiceOcrProvider {
  const provider = (Deno.env.get("INVENTORY_OCR_PROVIDER") || "openai").toLowerCase();
  if (provider !== "openai") throw new Error(`Unsupported INVENTORY_OCR_PROVIDER: ${provider}`);
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAiInvoiceOcrProvider(
    apiKey,
    Deno.env.get("INVENTORY_OCR_MODEL") || "gpt-4.1-mini"
  );
}
