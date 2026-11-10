import { fireEvent, render, screen } from "@testing-library/react";
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

function drag(from, to) {
  const target = screen.getByRole("button", { name: to });
  document.elementFromPoint = () => target;
  fireEvent.pointerDown(from, { clientX: 0, clientY: 0, button: 0 });
  fireEvent.pointerMove(from, { clientX: 40, clientY: 20 });
  fireEvent.pointerUp(from, { clientX: 48, clientY: 24 });
  fireEvent.pointerMove(window, { clientX: 40, clientY: 20 });
  fireEvent.pointerUp(window, { clientX: 48, clientY: 24 });
}

test("a host drags an arrived guest onto table 22 and later moves the same session", () => {
  render(<ServiceShell />);
  const geometry = screen.getByRole("button", { name: /Table 22/ }).getAttribute("data-x");
  book("Hana");
  fireEvent.click(screen.getByRole("button", { name: "Mark arrived" }));
  expect(screen.getByRole("button", { name: /Hana · 2 · Arrived/ })).toBeInTheDocument();
  drag(screen.getByRole("button", { name: /Hana · 2 · Arrived/ }), /Table 22/);
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Hana");
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Assigned");
  expect(screen.getByRole("button", { name: /Hana · 2 · Seated/ })).toBeInTheDocument();

  role("Waiter");
  fireEvent.click(screen.getByRole("button", { name: "Open dining session" }));
  fireEvent.click(screen.getByRole("button", { name: "Send Olives" }));
  role("Host");
  const session = screen.getByRole("button", { name: /Table 22/ }).getAttribute("data-session");
  expect(session).toBeTruthy();

  drag(screen.getByRole("button", { name: /Table 22/ }), /Table 23/);
  const moved = screen.getByRole("button", { name: /Table 23/ });
  expect(moved).toHaveTextContent("Hana");
  expect(moved).toHaveTextContent("Occupied");
  expect(moved.getAttribute("data-session")).toBe(session);
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Available");
  expect(screen.getByRole("button", { name: /Table 22/ }).getAttribute("data-x")).toBe(geometry);

  fireEvent.click(screen.getByRole("button", { name: /Table 24/ }));
  fireEvent.click(screen.getByRole("button", { name: "Join tables" }));
  expect(screen.getByRole("button", { name: /Table 24/ })).toHaveTextContent("Combined");
  expect(screen.getByRole("button", { name: /Table 22/ }).getAttribute("data-x")).toBe(geometry);
  expect(screen.getByTestId("service-summary")).toHaveTextContent("open sessions 1");

  role("Kitchen");
  fireEvent.click(screen.getByRole("button", { name: "Start preparing" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
  role("Waiter");
  fireEvent.click(screen.getByRole("button", { name: "Mark served" }));
  role("Cashier");
  fireEvent.click(screen.getByRole("button", { name: "Open bill" }));
  fireEvent.change(screen.getByLabelText("Payment amount"), { target: { value: "16" } });
  fireEvent.click(screen.getByRole("button", { name: "Pay with cash" }));
  fireEvent.click(screen.getByRole("button", { name: "Close table" }));
  role("Host");
  expect(screen.getByRole("button", { name: /Table 23/ })).toHaveTextContent("Available");
  expect(screen.getByRole("button", { name: /Table 24/ })).toHaveTextContent("Available");
  expect(screen.getByRole("button", { name: /Table 22/ }).getAttribute("data-x")).toBe(geometry);
});

test("a walk-in waits in Arrived until a table is chosen", () => {
  render(<ServiceShell />);
  fireEvent.click(screen.getByRole("button", { name: "Walk in" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "Nora" } });
  fireEvent.click(screen.getByRole("button", { name: "Add walk-in" }));
  expect(screen.getByRole("button", { name: /Nora · 2 · Arrived/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Upcoming/ })).toHaveTextContent("0");
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("No guest");
});
