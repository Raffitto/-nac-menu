/**
 * Tenant isolation hooks — single-tenant NAC today; structure ready for multi-brand SaaS.
 */

import { COMPANY_CONFIG } from "./companyConfig";

/** Active tenant identifier (build-time / future subdomain routing). */
export function getActiveTenantId() {
  const fromEnv = process.env.REACT_APP_TENANT_ID;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim().toLowerCase();
  return COMPANY_CONFIG.id;
}

export const TENANT_CONFIG = {
  defaultTenantId: COMPANY_CONFIG.id,
  features: {
    executiveCommandCenter: true,
    predictiveIntelligence: true,
    foodicsIntelligence: true,
    reviewIntelligence: true,
    boardroomMode: true,
  },
};

export function isTenantFeatureEnabled(featureKey) {
  return Boolean(TENANT_CONFIG.features[featureKey]);
}
