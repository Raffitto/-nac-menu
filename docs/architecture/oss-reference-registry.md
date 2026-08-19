# OSS reference registry (NAC engineering)

Check this registry **before** building another generic agent/orchestration stack or adding a paid SaaS.

Do **not** install these projects from this document. Adoption labels:

- **USE** — already chosen for a NAC module
- **EVALUATE** — later, with a license gate
- **REFERENCE ONLY** — read patterns; do not import
- **REJECTED** — tried or unfit; do not retry without new evidence

| Name | Purpose | URL | License | Status | Why | NAC module |
|---|---|---|---|---|---|---|
| OpenResto | Restaurant POS/ops reference | https://github.com/Open-Resto/OpenResto | verify upstream | REFERENCE ONLY | Do not replace Cash Up / Fabric | commerce adjacency |
| KitchenAsty | KDS reference | search GitHub | verify upstream | REFERENCE ONLY | KDS out of Ask NAC scope | KDS |
| FloCafe | Cafe ops reference | search GitHub | verify upstream | REFERENCE ONLY | Would be a rewrite | operations |
| OfferKit | Offers/promotions | search GitHub | verify upstream | REFERENCE ONLY | Not reasoning core | loyalty |
| TastyIgniter | Restaurant platform | https://github.com/tastyigniter/TastyIgniter | MIT (verify tag) | REFERENCE ONLY | Full platform ≠ Ask NAC | platform |
| Craftplan | Planning/manufacturing | search GitHub | **AGPL — caution** | REFERENCE ONLY | Copyleft risk; inventory out of scope | inventory |
| URY / ERPNext | Restaurant ERP | https://github.com/ury-erp/ury | **AGPL — caution** | REFERENCE ONLY | Would replace NAC ops | ERP |
| node-escpos | ESC/POS printing | https://github.com/song940/node-escpos | MIT (verify) | EVALUATE | Printing later | printing |
| ReceiptIO | Receipts | search GitHub | verify upstream | EVALUATE | Receipts later | printing |
| Playwright MCP | Browser automation | https://github.com/microsoft/playwright | Apache-2.0 | EVALUATE | Playwright/CDP can request Foodics UI export but cannot retrieve async email attachments without mailbox access. Official export chain is BLOCKED_EXTERNAL_DEPENDENCY. | evidence recovery |
| Darts | Time-series forecasting | https://github.com/unit8co/darts | Apache-2.0 | EVALUATE | Optional; NAC has event forecast | commercial.forecast |
| Activepieces CE | Self-hosted automation | https://github.com/activepieces/activepieces | MIT CE (verify paid pieces) | EVALUATE | Ingest jobs later; not a supervisor | scheduler |
| **OpenClaw** | LLM agent gateway | https://github.com/openclaw/openclaw | MIT | **REJECTED** | 2026.7.1-2 (`0790d9f`) failed as NAC supervisor (tool-arg hallucination, recovery miss). Keep `reasoningSupervisor.ts`. | Ask NAC supervisor |
| **Open-Meteo** | Historical weather | https://github.com/open-meteo/open-meteo | CC BY 4.0 data; AGPLv3 server; hosted free API is non-commercial | **USE** | Cache-first weather for External Reality v1. Do not use paid customer API. Self-host if production ToS requires. | `externalReality.weather` |
| whatsapp-web.js | Engineering WhatsApp bridge | https://github.com/wwebjs/whatsapp-web.js | Apache-2.0 | **EVALUATE** | NAC-COMMS proof: single-session ai-control bridge; not Ask NAC transport | `ai-control/comms` |
| wppconnect-server | REST WhatsApp bridge | https://github.com/wppconnect-team/wppconnect-server | Apache-2.0 | REFERENCE ONLY | Heavier multi-session REST; fallback if REST webhooks needed | `ai-control/comms` alt |

Canonical TypeScript copy: `supabase/functions/_shared/companyIntelligence/externalReality/ossReferenceRegistry.ts`
