/**
 * Identity resolution. Fuzzy names stay candidates.
 * A verified mapping is never rewritten onto historical movements by this function.
 */
export function resolveCanonicalIdentity({
  supplierId = null,
  supplierSku = null,
  externalId = null,
  name = null,
  verifiedMappings = [],
  aliases = [],
} = {}) {
  const verified = verifiedMappings.find((row) => (
    row.supplierId === supplierId && row.supplierSku && row.supplierSku === supplierSku && row.state === "verified"
  ));
  if (verified) {
    return { state: "verified", canonicalId: verified.canonicalId, method: "verified_mapping", candidate: false };
  }
  const external = verifiedMappings.find((row) => row.externalId && row.externalId === externalId && row.state === "verified");
  if (external) {
    return { state: "verified", canonicalId: external.canonicalId, method: "external_id", candidate: false };
  }
  const sku = verifiedMappings.find((row) => (
    row.supplierId === supplierId && row.supplierSku === supplierSku && row.state !== "verified"
  ));
  if (supplierSku && sku) {
    return { state: "candidate", canonicalId: null, method: "unverified_sku", candidate: true };
  }
  const alias = aliases.find((row) => row.supplierId === supplierId && row.alias === supplierSku && row.state === "verified");
  if (alias) {
    return { state: "verified", canonicalId: alias.canonicalId, method: "verified_alias", candidate: false };
  }
  if (name) {
    return { state: "candidate", canonicalId: null, method: "name_only", candidate: true, reason: "Name similarity is not an authoritative mapping." };
  }
  return { state: "unresolved", canonicalId: null, method: "none", candidate: false };
}
