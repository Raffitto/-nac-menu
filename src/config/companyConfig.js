/**
 * Company-level constants for NAC OS (future multi-tenant SaaS foundation).
 * Default values preserve current NAC production behavior.
 */

export const COMPANY_CONFIG = {
  id: "nac",
  legalName: "NAC Hospitality",
  productName: "NAC Hospitality OS",
  shortName: "NAC",
  supportEmail: "support@nac.com",
  region: "SA",
  currency: "SAR",
  timezone: "Asia/Riyadh",
};

export function getCompanyName() {
  return COMPANY_CONFIG.productName;
}
