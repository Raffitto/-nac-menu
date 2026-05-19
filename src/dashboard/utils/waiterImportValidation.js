import { canonicalStaffName, resolveStaffRole, staffRoleLabel } from "../config/staffRoles";

/**
 * Post-import validation totals by creator — compare to Foodics pivot.
 */
export function buildWaiterImportValidation(rows = []) {
  const byCreator = {};

  (rows || []).forEach((row) => {
    const name = canonicalStaffName(row.waiter_name || row.waiter || "Unassigned");
    if (!byCreator[name]) {
      byCreator[name] = {
        waiter: name,
        role: resolveStaffRole(name),
        roleLabel: staffRoleLabel(name),
        gross_sales: 0,
        net_sales: 0,
        quantity: 0,
        row_count: 0,
      };
    }
    const w = byCreator[name];
    w.gross_sales += Number(row.gross_sales) || 0;
    w.net_sales += Number(row.net_sales) || 0;
    w.quantity += Number(row.quantity_sold) || 0;
    w.row_count += 1;
  });

  const creators = Object.values(byCreator).sort((a, b) => b.gross_sales - a.gross_sales);
  const waiters = creators.filter((c) => c.role === "waiter");
  const managers = creators.filter((c) => c.role === "manager" || c.role === "admin");

  const totals = creators.reduce(
    (acc, c) => ({
      gross_sales: acc.gross_sales + c.gross_sales,
      net_sales: acc.net_sales + c.net_sales,
      quantity: acc.quantity + c.quantity,
      row_count: acc.row_count + c.row_count,
    }),
    { gross_sales: 0, net_sales: 0, quantity: 0, row_count: 0 },
  );

  return {
    creators,
    waiters,
    managers,
    totals,
    waiterTotals: waiters.reduce(
      (acc, c) => ({
        gross_sales: acc.gross_sales + c.gross_sales,
        net_sales: acc.net_sales + c.net_sales,
        quantity: acc.quantity + c.quantity,
        row_count: acc.row_count + c.row_count,
      }),
      { gross_sales: 0, net_sales: 0, quantity: 0, row_count: 0 },
    ),
  };
}
