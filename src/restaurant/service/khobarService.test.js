import { fireEvent, render, screen, within } from "@testing-library/react";
import ServiceShell from "./ServiceShell";

function role(name) {
  fireEvent.click(screen.getByRole("button", { name }));
}

test("a no-show stays on the reservation and does not take a table", () => {
  render(<ServiceShell />);
  fireEvent.click(screen.getByRole("button", { name: "Add reservation" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "Sami" } });
  fireEvent.click(screen.getByRole("button", { name: "Create reservation" }));
  fireEvent.click(screen.getByRole("button", { name: /Table 22/ }));
  fireEvent.click(screen.getByRole("button", { name: "Mark no-show" }));
  expect(screen.getByRole("button", { name: /Sami · 2 · No-show/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Available");
  expect(screen.getByRole("button", { name: "Seat on selected table" })).toBeDisabled();
});

test("table 22 is configured by a manager and then served through the bill", () => {
  render(<ServiceShell />);
  expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Desk access"), { target: { value: "manager" } });
  role("Waiter");
  expect(screen.queryByRole("button", { name: "Edit layout" })).not.toBeInTheDocument();
  role("Host");
  fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
  fireEvent.click(screen.getByRole("button", { name: /Table 22/ }));
  expect(screen.getByLabelText("Table number")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Minimum seats"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Maximum seats"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Set capacity" }));
  expect(screen.getByTestId("service-banner")).toHaveTextContent("Table 22 seats 2 to 4.");
  fireEvent.click(screen.getByRole("button", { name: "Back to service" }));

  fireEvent.click(screen.getByRole("button", { name: "Add reservation" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "Lina" } });
  fireEvent.change(screen.getByLabelText("Party size"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Create reservation" }));
  fireEvent.click(screen.getByRole("button", { name: /Table 22/ }));
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("2 to 4 seats");
  expect(screen.getByText(/larger than this table/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));

  fireEvent.click(screen.getByRole("button", { name: "Add reservation" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "Hana" } });
  fireEvent.change(screen.getByLabelText("Party size"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Create reservation" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark arrived" }));
  expect(screen.getByRole("button", { name: /Hana · 2 · Arrived/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Table 22/ }));
  fireEvent.click(screen.getByRole("button", { name: "Seat on selected table" }));
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Assigned");

  fireEvent.click(screen.getByRole("button", { name: "Edit layout" }));
  fireEvent.click(screen.getByRole("button", { name: /Table 22/ }));
  expect(screen.getByRole("button", { name: "Delete table" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Back to service" }));

  role("Waiter");
  fireEvent.click(screen.getByRole("button", { name: "Open dining session" }));
  fireEvent.click(screen.getByRole("button", { name: "Send Olives" }));
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
  expect(screen.getByText("Visit for Hana · 16 SAR")).toBeInTheDocument();

  role("Host");
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("Available");
  expect(screen.getByRole("button", { name: /Table 22/ })).toHaveTextContent("No guest");
  expect(screen.getByText("None seated")).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("region", { name: "Guests on this branch" })).getByRole("button", { name: "Hana" }));
  expect(screen.getByRole("region", { name: "Guest profile" })).toHaveTextContent("1 closed visits on this branch");
});
