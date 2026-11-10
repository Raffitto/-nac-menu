import { fireEvent, render, screen } from "@testing-library/react";
import ServiceShell from "./ServiceShell";
import { LAYOUT_STORAGE_KEY } from "./layoutDocument";

function book(name, party = "2") {
  fireEvent.click(screen.getByRole("button", { name: "Add reservation" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Party size"), { target: { value: party } });
  fireEvent.click(screen.getByRole("button", { name: "Create reservation" }));
}

test("the timeline and guest profile follow the booked reservation", () => {
  render(<ServiceShell />);
  book("Layla");
  expect(screen.getByRole("button", { name: /Layla · 2 · Booked/ })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Guest profile" })).toHaveTextContent("Layla");
  expect(screen.getByText("No closed visits on this branch.")).toBeInTheDocument();
  expect(screen.getAllByText("Indoor").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Outdoor").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Seats unverified");
});

test("managers edit the floor and hosts cannot move tables", () => {
  render(<ServiceShell />);
  expect(screen.queryByRole("button", { name: "Edit Floor Plan" })).not.toBeInTheDocument();
  const before = screen.getByRole("button", { name: /Table 12/ }).getAttribute("data-x");
  fireEvent.keyDown(screen.getByRole("button", { name: /Table 12/ }), { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: /Table 12/ }).getAttribute("data-x")).toBe(before);
  fireEvent.change(screen.getByLabelText("Desk access"), { target: { value: "manager" } });
  fireEvent.click(screen.getByRole("button", { name: "Edit Floor Plan" }));
  const table = screen.getByRole("button", { name: /Table 12/ });
  const start = Number(table.getAttribute("data-x"));
  fireEvent.keyDown(table, { key: "ArrowRight" });
  expect(Number(screen.getByRole("button", { name: /Table 12/ }).getAttribute("data-x"))).toBe(start + 4);
  expect(screen.getByRole("button", { name: /Table 12/ })).toHaveTextContent("Available");
});

test("a transfer waits for the dining session and then moves it", () => {
  render(<ServiceShell />);
  book("Layla");
  fireEvent.click(screen.getByRole("button", { name: /Table 12/ }));
  fireEvent.click(screen.getByRole("button", { name: "Seat on selected table" }));
  expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Waiter" }));
  fireEvent.click(screen.getByRole("button", { name: "Open dining session" }));
  fireEvent.click(screen.getByRole("button", { name: "Host" }));
  fireEvent.click(screen.getByRole("button", { name: /Table 14/ }));
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/table 14/i);
  expect(screen.getByRole("button", { name: /Table 14/ })).toHaveTextContent("Layla");
  expect(screen.getByRole("button", { name: /Table 14/ })).toHaveTextContent("Occupied");
  expect(screen.getByRole("button", { name: /Table 12/ })).toHaveTextContent("Available");
  fireEvent.click(screen.getByRole("button", { name: /Table 16/ }));
  fireEvent.click(screen.getByRole("button", { name: "Join tables" }));
  expect(screen.getByRole("button", { name: /Table 16/ })).toHaveTextContent("Combined");
  fireEvent.click(screen.getByRole("button", { name: /Table 18/ }));
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent(/release combination first/i);
  expect(screen.getByRole("button", { name: /Table 14/ })).toHaveTextContent("Occupied");
});

test("table 22 is in the service book and stays unverified until management sets seats", () => {
  render(<ServiceShell />);
  book("Layla");
  fireEvent.click(screen.getByRole("button", { name: /Table 22/ }));
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Seats unverified");
  expect(screen.getByRole("button", { name: "Seat on selected table" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
  expect(screen.getByRole("button", { name: /Layla · 2 · Cancelled/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Seat on selected table" })).toBeDisabled();
});

test("a moved Khobar table is stored apart from the service snapshot", () => {
  const storage = {
    map: new Map(),
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
    setItem(key, value) { this.map.set(key, String(value)); },
  };
  const first = render(<ServiceShell storage={storage} />);
  fireEvent.change(screen.getByLabelText("Desk access"), { target: { value: "manager" } });
  fireEvent.click(screen.getByRole("button", { name: "Edit Floor Plan" }));
  const table = screen.getByRole("button", { name: /Table 12/ });
  const next = String(Number(table.getAttribute("data-x")) + 4);
  fireEvent.keyDown(table, { key: "ArrowRight" });
  fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
  expect(storage.map.has(LAYOUT_STORAGE_KEY)).toBe(true);
  expect(storage.map.has("nac-restaurant-sim:v1:khobar")).toBe(true);
  first.unmount();
  render(<ServiceShell storage={storage} />);
  expect(screen.getByRole("button", { name: /Table 12/ }).getAttribute("data-x")).toBe(next);
});
