import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRestaurant, saveServiceSnapshot } from "../model";
import ServiceShell from "./ServiceShell";

function role(name) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function book(name, party = "2") {
  fireEvent.click(screen.getByRole("button", { name: "Add reservation" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Party size"), { target: { value: party } });
  fireEvent.click(screen.getByRole("button", { name: "Create reservation" }));
}

function selectTable12() {
  fireEvent.click(screen.getByRole("button", { name: /Table 12/ }));
}

function seatLayla() {
  book("Layla");
  selectTable12();
  fireEvent.click(screen.getByRole("button", { name: "Seat on selected table" }));
}

function openLayla() {
  seatLayla();
  role("Waiter");
  fireEvent.click(screen.getByRole("button", { name: "Open dining session" }));
}

test("an empty guest name is refused by the service", () => {
  render(<ServiceShell />);
  fireEvent.click(screen.getByRole("button", { name: "Add reservation" }));
  fireEvent.click(screen.getByRole("button", { name: "Create reservation" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/guest name required/i);
  expect(screen.getByText("No guests yet.")).toBeInTheDocument();
});

test("an unverified Khobar table does not invent a seat count", () => {
  render(<ServiceShell />);
  book("Layla", "3");
  selectTable12();
  expect(screen.getByText(/capacity is unverified/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark arrived" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Cancel reservation" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Mark no-show" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Change covers" })).toBeDisabled();
  expect(screen.getByText(/cover changes are not a separate action/i)).toBeInTheDocument();
});

test("the waiting list stays on the screen until it is booked", () => {
  render(<ServiceShell />);
  fireEvent.click(screen.getByRole("button", { name: /Waiting list/ }));
  fireEvent.change(screen.getByLabelText("Waiting list name"), { target: { value: "Sami" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to waiting list" }));
  expect(screen.getByText(/screen only/i)).toBeInTheDocument();
  const guests = screen.getByRole("region", { name: "Guests on this branch" });
  expect(within(guests).queryByText(/Sami/)).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Screen-only waiting list" })).getAllByText(/Sami/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Search guests"), { target: { value: "Sami" } });
  expect(screen.getByText("No guests yet.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Book from waiting list" }));
  expect(within(screen.getByRole("region", { name: "Guests on this branch" })).getAllByText(/Sami/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Search guests"), { target: { value: "Nope" } });
  expect(screen.getByText("No matching guest on this branch.")).toBeInTheDocument();
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/reservation/i);
});

test("a walk-in is seated through the reservation contract", () => {
  render(<ServiceShell />);
  fireEvent.click(screen.getByRole("button", { name: "Walk in" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "Nora" } });
  fireEvent.click(screen.getByRole("button", { name: "Add walk-in" }));
  expect(screen.getByRole("button", { name: /Nora · 2 · Arrived/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Table 12/ })).not.toHaveTextContent("Nora");
  selectTable12();
  fireEvent.click(screen.getByRole("button", { name: "Seat on selected table" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/seated/i);
  expect(screen.getByRole("button", { name: /Table 12/ })).toHaveTextContent("Nora");
  expect(screen.getByRole("button", { name: /Table 12/ })).toHaveTextContent("Assigned");
});

test("switching branch opens that branch's empty simulation", () => {
  render(<ServiceShell />);
  book("Layla");
  fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "riyadh" } });
  expect(screen.getByRole("heading", { name: "Riyadh" })).toBeInTheDocument();
  expect(screen.queryByText(/Layla/)).not.toBeInTheDocument();
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/nothing was written/i);
  expect(screen.getByText(/Khobar floor stays on Khobar/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Table 50/ })).not.toBeInTheDocument();
});

test("an incomplete catalogue line is hidden and an unknown item cannot be sent", () => {
  render(<ServiceShell catalogue={[
    { itemId: "toast", name: "French Toast", price: "59 SAR", modifiers: [] },
    { name: "Broken", price: 5 },
    { itemId: "water", name: "Water", price: 8, modifiers: [] },
  ]} />);
  role("Waiter");
  expect(screen.getByRole("heading", { name: "French Toast" })).toBeInTheDocument();
  expect(screen.queryByText("Broken")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Olives" })).not.toBeInTheDocument();
  expect(screen.getByText("1 catalogue line is incomplete and hidden.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Water" })).toBeInTheDocument();
  expect(screen.getByText(/not in the simulated service menu/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send Water" })).toBeDisabled();
});

test("a delayed ticket is marked from the screen clock", () => {
  render(<ServiceShell now={Date.now() + (6 * 60 * 1000)} />);
  openLayla();
  fireEvent.click(screen.getByRole("button", { name: "Send Olives" }));
  role("Kitchen");
  const card = screen.getByRole("article");
  expect(card).toHaveAttribute("data-delayed", "true");
  expect(within(card).getByText("Delayed")).toBeInTheDocument();
  expect(within(card).getByText(/Seen at/)).toBeInTheDocument();
  expect(screen.getAllByTestId(/kitchen-ticket-/)).toHaveLength(1);
});

test("host, waiter, kitchen, and cashier share one simulated service", () => {
  render(<ServiceShell />);
  openLayla();
  expect(screen.getByRole("button", { name: "Dining session is open" })).toBeDisabled();
  expect(screen.getByTestId("service-summary")).toHaveTextContent("open sessions 1");

  fireEvent.click(screen.getByRole("checkbox", { name: /Extra honey/ }));
  fireEvent.change(screen.getByLabelText("Special instructions for French Toast"), { target: { value: "No nuts" } });
  fireEvent.click(screen.getByRole("button", { name: "Send French Toast" }));
  expect(within(screen.getByRole("region", { name: "Open order" })).getByText("63 SAR")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Open order" })).getByText(/Instruction: No nuts/)).toBeInTheDocument();

  role("Kitchen");
  expect(screen.getAllByTestId(/kitchen-ticket-/)).toHaveLength(1);
  const card = screen.getByRole("article");
  expect(within(card).getByText(/No nuts/)).toBeInTheDocument();
  expect(within(card).getByText(/Each item keeps its own status/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Grill/ })).toBeDisabled();
  fireEvent.click(within(card).getByRole("button", { name: "Start preparing" }));
  expect(screen.getByRole("article")).toHaveAttribute("data-status", "preparing");
  expect(within(screen.getByRole("article")).getAllByText("Preparing").length).toBeGreaterThan(1);
  fireEvent.click(within(screen.getByRole("article")).getByRole("button", { name: "Mark ready" }));
  expect(screen.getByRole("article")).toHaveAttribute("data-status", "ready");

  role("Waiter");
  fireEvent.click(screen.getByRole("button", { name: "Mark served" }));
  fireEvent.click(screen.getByRole("button", { name: "Request bill" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/no bill was created/i);

  role("Cashier");
  expect(screen.getByText("Bill requested on the waiter screen")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open bill" }));
  expect(screen.getByText("Bill total 63 SAR · Open")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Pay with transfer" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/payment exceeds bill/i);
  expect(screen.getByText(/No payments yet/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Pay with cash" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/simulated/i);
  expect(screen.getByText(/Paid 30 SAR/)).toBeInTheDocument();
  expect(screen.getByText(/Remaining 33 SAR/)).toBeInTheDocument();
  expect(screen.getByLabelText("Payment amount")).toHaveValue("33");
  fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "33" } });
  fireEvent.click(screen.getByRole("button", { name: "Pay with card" }));
  expect(screen.getByText(/Paid in full/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apply discount" })).toBeDisabled();
  expect(screen.getByText(/not permitted to discount/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Split into separate bills" })).toBeDisabled();
  expect(screen.getByText(/Separate checks are not in the service contract/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close table" }));
  expect(screen.getByText("Visit for Layla · 63 SAR")).toBeInTheDocument();
  expect(screen.getByText(/Cash · 30 SAR · contract method simulated/)).toBeInTheDocument();
  expect(screen.getByText(/Card · 33 SAR · contract method simulated/)).toBeInTheDocument();
  expect(screen.getByTestId("service-summary")).toHaveTextContent("visits 1");
  expect(screen.getByTestId("service-summary")).toHaveTextContent("paid bills 1");
  expect(screen.getByTestId("service-summary")).toHaveTextContent("open sessions 0");
  expect(screen.getByTestId("service-identity")).toHaveTextContent(/one ticket/i);

  role("Host");
  expect(screen.getByRole("button", { name: /Table 12/ })).toHaveTextContent("Available");
  expect(screen.getByRole("button", { name: /Table 12/ })).toHaveTextContent("No guest");
  expect(screen.getByText("None seated")).toBeInTheDocument();
});

test("a refresh restores the completed visit, payment, and seated count", () => {
  const restaurant = createRestaurant({ branchId: "khobar" });
  const booked = restaurant.reserve({ guestName: "Layla", partySize: 2 });
  restaurant.assignTable(booked.reservation.id, "khobar:12");
  const opened = restaurant.openSession("khobar:12");
  restaurant.addItem(opened.session.id, { itemId: "olives" });
  restaurant.setKitchenStatus(opened.order.id, "preparing");
  restaurant.setKitchenStatus(opened.order.id, "ready");
  restaurant.markServed(opened.order.id);
  const bill = restaurant.openBill(opened.session.id);
  restaurant.pay(opened.session.id, {
    amount: bill.bill.total,
    tender: "cash",
    recordedAt: "2026-11-08T06:12:00.000Z",
    clientPaymentId: "layla-refresh",
  });
  restaurant.closeTable(opened.session.id);
  const storage = {
    map: new Map(),
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
    setItem(key, value) { this.map.set(key, String(value)); },
  };
  saveServiceSnapshot(storage, restaurant);
  render(<ServiceShell storage={storage} />);
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/1 completed visit/i);
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/0 seated reservations/i);
  expect(screen.getByTestId("service-banner")).not.toHaveTextContent(/ready for the first reservation/i);
  expect(screen.getByText("None seated")).toBeInTheDocument();
  role("Cashier");
  expect(screen.getByText(/Cash · 16 SAR · contract method simulated/)).toBeInTheDocument();
  expect(screen.queryByText(/no timestamp/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Visit for Layla · 16 SAR/)).toBeInTheDocument();
});
