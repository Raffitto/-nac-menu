/**
 * Visual branding tokens — white-label ready; defaults match NAC production identity.
 */

import { COMPANY_CONFIG } from "./companyConfig";

export const BRANDING_CONFIG = {
  tenantId: COMPANY_CONFIG.id,
  logoPath: "/logo.png",
  colors: {
    teal: "#30484e",
    tealMid: "#3d5c64",
    gold: "#8f7a57",
    goldLight: "#d7bc8a",
    cream: "#f9f9f7",
    surface: "#0a0d0f",
  },
  typography: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, sans-serif',
  },
  terminology: {
    branch: "Branch",
    branches: "Branches",
    network: "Network",
    executiveBrief: "Executive brief",
  },
};

export function getBrandColors() {
  return BRANDING_CONFIG.colors;
}
