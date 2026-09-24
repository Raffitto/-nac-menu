/**
 * Menu catalogue sidebar / main-area contract.
 * A failed read must not look like a genuinely empty database.
 */
export function menuCatalogueView({ loading, error, categoryCount }) {
  const count = Number(categoryCount) || 0;
  if (count > 0) return error ? "stale" : "ready";
  if (loading) return "loading";
  if (error) return "failed";
  return "empty";
}
