import { fireEvent, render, screen } from "@testing-library/react";
import WaiterPos from "./WaiterPos";

const lines = [{
  itemId: "toast",
  name: "French Toast",
  nameAr: "توست",
  price: 59,
  modifiers: [{ id: "honey", name: "Extra honey", price: 4 }],
  available: true,
  categoryId: "breakfast",
  categoryName: "Breakfast",
  categorySlug: "breakfast",
  categorySort: 2,
  sectionId: "sweets",
  sectionName: "Sweets",
  sectionSort: 1,
  image: null,
}];

function memory() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("a waiter seats a table, sends a noted item, and reopens the same order after refresh", () => {
  const storage = memory();
  const clockStorage = memory();
  const view = render(
    <WaiterPos lines={lines} storage={storage} clockStorage={clockStorage} now={Date.parse("2026-11-08T10:00:00")} />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Table 12,/ }));
  expect(screen.getByRole("button", { name: /Table 12,/ })).toHaveAccessibleName(/Seats unverified/);
  expect(screen.getByRole("button", { name: /Table 12,/ })).not.toHaveAccessibleName(/\d+ seats/);
  fireEvent.click(screen.getByRole("button", { name: "Start order" }));
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "Rana" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));

  expect(screen.getByText("Dine in (Table 12)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rana" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sweets" }));
  fireEvent.click(screen.getByRole("button", { name: /French Toast/ }));
  fireEvent.click(screen.getByRole("button", { name: /Extra honey/ }));
  fireEvent.change(screen.getByLabelText("Item note"), { target: { value: "Cut in half" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to order" }));
  expect(screen.getByText(/Not sent/)).toBeInTheDocument();
  expect(screen.getByText("Cut in half")).toBeInTheDocument();

  const beforePrint = screen.getByTestId("waiter-pos").getAttribute("data-revision");
  fireEvent.click(screen.getByRole("button", { name: "Print" }));
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.getByText(/Nothing was printed/)).toBeInTheDocument();
  expect(screen.getByTestId("waiter-pos")).toHaveAttribute("data-revision", beforePrint);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  fireEvent.click(screen.getByRole("button", { name: "Send to Kitchen" }));
  expect(screen.getByText("Sent to the kitchen.")).toBeInTheDocument();
  expect(screen.getByText(/Kitchen · Sent/)).toBeInTheDocument();
  expect(screen.getByTestId("pos-total")).toHaveTextContent("63.00 SAR");
  expect(screen.getByText("Not on this check")).toBeInTheDocument();
  expect(screen.queryByText(/15%/)).not.toBeInTheDocument();

  const root = screen.getByTestId("waiter-pos");
  const sessionId = root.getAttribute("data-session");
  const orderId = root.getAttribute("data-order");
  const ticketId = root.getAttribute("data-ticket");
  const revision = root.getAttribute("data-revision");
  fireEvent.click(screen.getByRole("button", { name: /1 × French Toast/ }));
  fireEvent.click(screen.getByRole("button", { name: "Void" }));
  expect(screen.getByText(/cannot be voided/)).toBeInTheDocument();
  expect(screen.getByTestId("waiter-pos")).toHaveAttribute("data-revision", revision);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));

  fireEvent.click(screen.getByRole("button", { name: "Tables" }));
  fireEvent.click(screen.getByRole("button", { name: /Table 12,/ }));
  expect(screen.getByRole("button", { name: "Open order" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open order" }));
  expect(screen.getByText("Cut in half")).toBeInTheDocument();
  expect(screen.getByTestId("waiter-pos")).toHaveAttribute("data-sessions", "1");

  view.unmount();
  render(<WaiterPos lines={lines} storage={storage} clockStorage={clockStorage} now={Date.parse("2026-11-08T10:30:00")} />);
  const restored = screen.getByRole("button", { name: /Table 12,/ });
  expect(restored).toHaveAccessibleName(/Rana/);
  expect(restored).toHaveAccessibleName(/Dining/);
  expect(restored).toHaveAccessibleName(/Seats unverified/);
  fireEvent.click(restored);
  fireEvent.click(screen.getByRole("button", { name: "Open order" }));
  const again = screen.getByTestId("waiter-pos");
  expect(again).toHaveAttribute("data-session", sessionId);
  expect(again).toHaveAttribute("data-order", orderId);
  expect(again).toHaveAttribute("data-ticket", ticketId);
  expect(again).toHaveAttribute("data-sessions", "1");
  expect(screen.getByText("Cut in half")).toBeInTheDocument();
  expect(screen.getByTestId("pos-total")).toHaveTextContent("63.00 SAR");
});
