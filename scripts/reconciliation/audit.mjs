import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(fs.readFileSync(path.join(here, 'checkpoint.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(here, '../../src/lib/data/nacMenuIdentities.json'), 'utf8'));
const source = fs.readFileSync(path.join(here, '../../src/lib/mappingTargetResolution.js'), 'utf8');
const { resolveMappingTarget } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const resolutions = input.historicalLinks.map((row) => ({ sku: row.product_sku, ...resolveMappingTarget(row.matched_menu_item_id, input) }));
const errors = [];
const seen = new Set();
for (const variant of registry.variants) {
  const foodics = input.foodicsProducts.find((f) => f.id === variant.foodicsProductId && f.sku === variant.foodicsSku);
  if (!foodics) errors.push(`Unknown Foodics identity: ${variant.foodicsSku}`);
  for (const id of variant.placementIds) {
    const item = input.menuItems.find((i) => i.id === id);
    if (!item || item.branch_id !== variant.sourceBranchId || seen.has(id)) errors.push(`Invalid confirmed placement: ${id}`);
    seen.add(id);
  }
}
const proposed = input.proposedBindings.map((row) => {
  const item = input.menuItems.find((i) => i.id === row.digital_item_id);
  const foodics = input.foodicsProducts.find((f) => f.id === row.candidate_foodics_id && f.sku === row.candidate_sku);
  if (!item || !foodics) errors.push(`Unknown proposal reference: ${row.digital_item_id}`);
  if (seen.has(row.digital_item_id)) errors.push(`Proposal silently confirmed: ${row.digital_item_id}`);
  return { placementId: row.digital_item_id, sku: row.candidate_sku, status: row.resolution, referenceIntegrity: item && foodics ? 'verified' : 'failed', semanticEquivalence: row.resolution === 'Supported proposal' ? 'proposed_only' : 'unresolved', recipeMutation: false };
});
const report = {
  source: 'Saved 2026-10-24 evidence, no network or production writes',
  historicalTargets: Object.fromEntries(['resolved_menu_item', 'resolved_addon', 'unresolved', 'ambiguous_target'].map((status) => [status, resolutions.filter((r) => r.status === status).length])),
  confirmedVariants: registry.variants.length,
  confirmedPlacementBindings: seen.size,
  focusedBindings: proposed,
  errors,
};
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
