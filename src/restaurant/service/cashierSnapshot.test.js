import { render, screen } from "@testing-library/react";
import CashierWorkspace from "./CashierWorkspace";
const { RECONSTRUCTED_LIMIT } = require("../priceSnapshot");

function renderCashier(bill, items) {
  render(
    <CashierWorkspace
      restaurant={{
        state: {
          developmentDatabase: true,
          sessions: [{ id: "session-1", status: "open", tableId: "khobar:12", guestId: "guest-1" }],
          tables: [{ id: "khobar:12", label: "12" }],
          guests: [{ id: "guest-1", name: "Eggs Check" }],
          orders: [{ id: "order-1", sessionId: "session-1", items }],
          bills: [bill],
          payments: [],
          visits: [],
          adjustments: [],
        },
      }}
      dispatch={() => ({ ok: false })}
      screen={{ billRequests: {}, tenders: {}, notes: {} }}
      setScreen={() => {}}
      role="cashier"
    />,
  );
}

test("a snapshotted bill shows the persisted amount", () => {
  renderCashier(
    { id: "bill-1", sessionId: "session-1", status: "open", total: 100, totalMinor: 10000, outstanding: 100, amountProvenance: "snapshot", paid: false },
    [{ id: "line-1", name: "2 Eggs Any Style", price: 100, priceMinor: 10000, status: "queued", modifiers: [] }],
  );
  expect(screen.getByText(/Persisted total 100 SAR/)).toBeInTheDocument();
  expect(screen.queryByText(RECONSTRUCTED_LIMIT)).not.toBeInTheDocument();
});

test("a legacy bill identifies the reconstructed amount", () => {
  renderCashier(
    { id: "bill-1", sessionId: "session-1", status: "open", total: 100, totalMinor: 10000, outstanding: 100, amountProvenance: "reconstructed", amountLimitation: RECONSTRUCTED_LIMIT, paid: false },
    [{ id: "line-1", name: "2 Eggs Any Style", price: 100, status: "queued", modifiers: [] }],
  );
  expect(screen.getByText(RECONSTRUCTED_LIMIT)).toBeInTheDocument();
});
