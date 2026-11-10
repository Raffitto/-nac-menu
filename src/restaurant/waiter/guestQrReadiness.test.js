import { guestQrReadiness } from "./guestQrReadiness";

test("guest QR stays off and binds to the open table session", () => {
  const readiness = guestQrReadiness({
    branchId: "khobar",
    tableId: "khobar:16",
    sessionId: "session-5",
  });
  expect(readiness).toMatchObject({
    enabled: false,
    contractEnabled: false,
    writes: 0,
    createsOrder: false,
    createsSession: false,
    createsBill: false,
    notifiesGuest: false,
    reason: "qr_ordering_not_activated",
    catalogue: "khobar-guest-menu",
    sharesTableSession: true,
    sharesOrder: true,
    sharesBill: true,
    confirmation: "not_configured",
    bindsTo: { branchId: "khobar", tableId: "khobar:16", sessionId: "session-5" },
  });
});
