/**
 * Laptop-off / zero-recurring-cost hosting evaluation for WhatsApp Web bridge.
 */

const HOSTING_VERDICT = Object.freeze({
  CODE: "FREE_SOFTWARE_PROVEN_LAPTOP_OFF_HOSTING_BLOCKED",
  LABEL:
    "FREE SOFTWARE PROVEN; LAPTOP-OFF 24/7 HOSTING BLOCKED IN FOUNDER-FREE MODE",
  recurringCost: 0,
  paidCalls: 0,
});

const RUNTIME_OPTIONS = Object.freeze([
  {
    name: "GitHub Actions (nac-ai-control.yml)",
    persistentWhatsAppSession: false,
    recurringCost: 0,
    notes: "Event-driven, short-lived runners; cannot hold Chromium/WhatsApp Web 24/7.",
    usableForBridge: false,
  },
  {
    name: "Cursor Cloud Agents (@cursor on Control Room issue)",
    persistentWhatsAppSession: false,
    recurringCost: 0,
    notes: "On-demand engineering worker; ideal for task execution, not WhatsApp session host.",
    usableForBridge: false,
    usableForWorker: true,
  },
  {
    name: "Supabase Edge Functions",
    persistentWhatsAppSession: false,
    recurringCost: 0,
    notes: "No long-lived Puppeteer; wrong runtime for unofficial WhatsApp Web client.",
    usableForBridge: false,
  },
  {
    name: "Netlify / static admin",
    persistentWhatsAppSession: false,
    recurringCost: 0,
    notes: "Not a process host; untouched for this proof.",
    usableForBridge: false,
  },
  {
    name: "Raffi laptop (local Node + LocalAuth)",
    persistentWhatsAppSession: true,
    recurringCost: 0,
    notes: "Proof send/receive feasible when machine is on; session dir must stay out of git.",
    usableForBridge: true,
    requiresLaptopOn: true,
  },
  {
    name: "Future: cheapest VPS / home always-on device",
    persistentWhatsAppSession: true,
    recurringCost: "low but non-zero unless existing hardware",
    notes: "Closest safe architecture if founder approves minimal hosting spend or uses existing always-on hardware.",
    usableForBridge: true,
    requiresPurchase: true,
  },
]);

function getHostingEvaluation() {
  return {
    verdict: HOSTING_VERDICT,
    runtimeOptions: RUNTIME_OPTIONS,
    freePersistentHostFound: false,
    recommendation:
      "Prove bridge locally or on Raffi laptop; for laptop-off engineering use Cursor Cloud Agents on issue #2. " +
      "For laptop-off WhatsApp, need always-on host (existing hardware or future approved minimal VPS) — not available at $0 without Raffi machine.",
  };
}

module.exports = { HOSTING_VERDICT, RUNTIME_OPTIONS, getHostingEvaluation };
