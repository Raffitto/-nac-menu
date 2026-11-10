import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { GuestOrderTray, GuestTableOrder } from "./GuestTableOrder";

test("the menu does not show ordering without a guest token", () => {
  render(<GuestTableOrder item={{ id: "x", en: "Olives" }} />);
  render(<GuestOrderTray />);
  expect(screen.queryByRole("button", { name: "Add to order" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit for staff confirmation" })).not.toBeInTheDocument();
});

test("a guest token does not show ordering while the owner switch is off", async () => {
  window.history.pushState({}, "", "/?guest-token=local-test-token");
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
    json: async () => ({ ok: true, guestOrdering: false, guestPayments: false, paymentCaptured: false }),
  });
  render(<GuestTableOrder item={{ id: "x", en: "Olives" }} />);
  render(<GuestOrderTray />);
  expect(screen.queryByRole("button", { name: "Add to order" })).not.toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Add to order" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit for staff confirmation" })).not.toBeInTheDocument();
  fetchMock.mockRestore();
  window.history.pushState({}, "", "/");
});

test("ordering controls appear only after the server says the owner switch is on", async () => {
  window.history.pushState({}, "", "/?guest-token=local-test-token");
  const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
    const path = String(url);
    if (path.endsWith("/guest/ordering-status")) {
      return { json: async () => ({ ok: true, guestOrdering: true, guestPayments: false, paymentCaptured: false }) };
    }
    return { json: async () => ({ ok: true, items: [{ id: "olives", name: "Olives", price: "16 SAR", modifiers: [{ id: "bacon", name: "Beef Bacon", price: "19 SAR" }] }] }) };
  });
  render(<GuestTableOrder item={{ id: "olives", en: "Olives" }} />);
  expect(await screen.findByRole("button", { name: "Add to order" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Beef Bacon/ })).toBeInTheDocument();
  fetchMock.mockRestore();
  window.history.pushState({}, "", "/");
});
