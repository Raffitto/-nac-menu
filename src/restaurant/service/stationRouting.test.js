import { fireEvent, render, screen } from "@testing-library/react";
import KitchenWorkspace from "./KitchenWorkspace";

function restaurant() {
  return {
    state: {
      developmentDatabase: true,
      tables: [{ id: "khobar:12", label: "12" }],
      sessions: [{ id: "session-1", tableId: "khobar:12", guestId: "guest-1", status: "open" }],
      guests: [{ id: "guest-1", name: "Eggs Check" }],
      orders: [{
        id: "order-1",
        sessionId: "session-1",
        items: [
          { id: "line-kitchen", name: "2 Eggs Any Style", status: "queued", station: "kitchen", routing: "routed", instructions: "No salt", modifiers: [], quantity: 2, price: 100 },
          { id: "line-bar", name: "Orange Juice", status: "queued", station: "bar", routing: "routed", modifiers: [], quantity: 1, price: 22 },
          { id: "line-open", name: "Unassigned Toast", status: "queued", station: null, routing: "unassigned", modifiers: [], quantity: 1, price: 59 },
        ],
      }],
      tickets: [
        { id: "ticket:order-1:kitchen", orderId: "order-1", sessionId: "session-1", status: "queued", station: "kitchen", stationName: "Kitchen" },
        { id: "ticket:order-1:bar", orderId: "order-1", sessionId: "session-1", status: "queued", station: "bar", stationName: "Bar" },
      ],
      stations: [
        { id: "station-kitchen", code: "kitchen", name: "Kitchen", active: true },
        { id: "station-bar", code: "bar", name: "Bar", active: true },
      ],
    },
  };
}

test("kitchen and bar views show only items routed to that station", () => {
  render(
    <KitchenWorkspace
      restaurant={restaurant()}
      dispatch={() => ({ ok: true })}
      screen={{ clocks: {} }}
      currentTime={Date.parse("2026-11-10T12:00:00Z")}
      onRole={() => {}}
    />,
  );
  expect(screen.getByText("2 Eggs Any Style")).toBeInTheDocument();
  expect(screen.queryByText("Orange Juice")).not.toBeInTheDocument();
  expect(screen.queryByText("Unassigned Toast")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Bar" }));
  expect(screen.getByText("Orange Juice")).toBeInTheDocument();
  expect(screen.queryByText("2 Eggs Any Style")).not.toBeInTheDocument();
  expect(screen.queryByText("Unassigned Toast")).not.toBeInTheDocument();
});
