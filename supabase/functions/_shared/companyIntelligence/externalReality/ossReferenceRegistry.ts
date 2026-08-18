/**
 * OSS / self-host reference registry for future NAC engineering.
 * Check this file before implementing another generic framework or paid SaaS.
 * Do not install these projects from this document.
 */

export type OssAdoption = "USE" | "EVALUATE" | "REFERENCE ONLY" | "REJECTED";

export type OssReference = {
  name: string;
  purpose: string;
  url: string;
  license: string;
  adoption: OssAdoption;
  why: string;
  nacModule: string;
};

export const OSS_REFERENCE_REGISTRY: OssReference[] = [
  {
    name: "OpenResto",
    purpose: "Open-source restaurant POS / ops reference",
    url: "https://github.com/Open-Resto/OpenResto",
    license: "verify upstream before use",
    adoption: "REFERENCE ONLY",
    why: "Useful POS/ops patterns; NAC already has canonical commercial authority and must not replace Cash Up/Foodics contracts.",
    nacModule: "commerce / POS adjacency (not in this milestone)",
  },
  {
    name: "KitchenAsty",
    purpose: "Kitchen display / kitchen workflow reference",
    url: "https://github.com/search?q=KitchenAsty",
    license: "verify upstream before use",
    adoption: "REFERENCE ONLY",
    why: "KDS is out of current Ask NAC scope.",
    nacModule: "KDS (out of scope)",
  },
  {
    name: "FloCafe",
    purpose: "Cafe/restaurant operations reference",
    url: "https://github.com/search?q=FloCafe",
    license: "verify upstream before use",
    adoption: "REFERENCE ONLY",
    why: "Do not replace NAC Fabric; cafe workflows only.",
    nacModule: "operations (out of scope this milestone)",
  },
  {
    name: "OfferKit",
    purpose: "Offers / promotions kit reference",
    url: "https://github.com/search?q=OfferKit",
    license: "verify upstream before use",
    adoption: "REFERENCE ONLY",
    why: "Promotions are not Ask NAC reasoning core.",
    nacModule: "loyalty/offers (out of scope)",
  },
  {
    name: "TastyIgniter",
    purpose: "Open-source restaurant platform",
    url: "https://github.com/tastyigniter/TastyIgniter",
    license: "MIT (verify tag)",
    adoption: "REFERENCE ONLY",
    why: "Full restaurant platform would be a rewrite; NAC needs intelligence on existing canonical data.",
    nacModule: "platform (do not adopt)",
  },
  {
    name: "Craftplan",
    purpose: "Manufacturing/planning reference",
    url: "https://github.com/search?q=craftplan",
    license: "AGPL — reference caution",
    adoption: "REFERENCE ONLY",
    why: "AGPL copyleft risk if linked into NAC. Inventory/planning out of Ask NAC scope.",
    nacModule: "inventory (out of scope)",
  },
  {
    name: "URY / ERPNext",
    purpose: "Restaurant ERP on ERPNext",
    url: "https://github.com/ury-erp/ury",
    license: "AGPL — reference caution",
    adoption: "REFERENCE ONLY",
    why: "AGPL; would replace NAC ops stack. Not a supervisor for Ask NAC.",
    nacModule: "ERP (out of scope)",
  },
  {
    name: "node-escpos",
    purpose: "ESC/POS printing",
    url: "https://github.com/song940/node-escpos",
    license: "MIT (verify)",
    adoption: "EVALUATE",
    why: "Printing is out of this milestone; keep as future POS/print option.",
    nacModule: "printing (out of scope now)",
  },
  {
    name: "ReceiptIO",
    purpose: "Receipt generation",
    url: "https://github.com/search?q=ReceiptIO",
    license: "verify upstream before use",
    adoption: "EVALUATE",
    why: "Receipts out of Ask NAC External Reality scope.",
    nacModule: "printing (out of scope now)",
  },
  {
    name: "Playwright MCP",
    purpose: "Browser automation MCP",
    url: "https://github.com/microsoft/playwright",
    license: "Apache-2.0",
    adoption: "EVALUATE",
    why: "Useful later for bounded acquisition; not for unrestricted browsing from Ask NAC.",
    nacModule: "evidence recovery / acquisition",
  },
  {
    name: "Darts",
    purpose: "Time-series forecasting (Python)",
    url: "https://github.com/unit8co/darts",
    license: "Apache-2.0",
    adoption: "EVALUATE",
    why: "NAC already has a bounded event forecast; Darts is optional later, not a supervisor.",
    nacModule: "commercial.forecast",
  },
  {
    name: "Activepieces CE",
    purpose: "Self-hosted automation (Zapier-like)",
    url: "https://github.com/activepieces/activepieces",
    license: "MIT (CE; verify commercial pieces)",
    adoption: "EVALUATE",
    why: "Could orchestrate ingest jobs later. Not an Ask NAC reasoning brain. Avoid paid pieces.",
    nacModule: "scheduler / ingest (out of this milestone)",
  },
  {
    name: "OpenClaw",
    purpose: "Self-hosted LLM agent gateway / supervisor candidate",
    url: "https://github.com/openclaw/openclaw",
    license: "MIT",
    adoption: "REJECTED",
    why: "2026.7.1-2 (0790d9f) proof failed: hallucinated tool args, extra tool fan-out, no unresolved-goal recovery vs NAC reasoningSupervisor.ts. Keep Fabric supervisor.",
    nacModule: "Ask NAC supervisor (do not replace)",
  },
  {
    name: "Open-Meteo",
    purpose: "Historical weather (ERA5) — External Reality v1",
    url: "https://github.com/open-meteo/open-meteo",
    license: "API data CC BY 4.0; server AGPLv3; hosted free API non-commercial ToS",
    adoption: "USE",
    why: "No API key, cacheable historical weather. Production commercial path should self-host or keep cache-only; do not use paid customer endpoint.",
    nacModule: "externalReality.weather",
  },
];

export const CONTROL_PROTOCOL_META = Object.freeze({
  protocolVersion: 1,
  validated: true,
  taskId: "NAC-CTRL-0001",
});
