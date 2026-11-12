/**
 * Readiness for a future guest QR order on the same table session.
 * The platform plan stays disabled. This module does not open a session,
 * order, ticket, or bill, and it does not notify a guest.
 */
import { planQrOrderingSession } from "../platformContract";

export function guestQrReadiness({ branchId, tableId, sessionId } = {}) {
  const plan = planQrOrderingSession({ branchId, tableId, sessionId });
  return {
    ok: plan.ok === true,
    enabled: false,
    contractEnabled: plan.enabled === true,
    writes: 0,
    createsOrder: false,
    createsSession: false,
    createsBill: false,
    notifiesGuest: false,
    reason: plan.reason,
    bindsTo: plan.bindsTo,
    catalogue: "khobar-guest-menu",
    sharesTableSession: Boolean(sessionId),
    sharesOrder: Boolean(sessionId),
    sharesBill: Boolean(sessionId),
    confirmation: "not_configured",
  };
}
