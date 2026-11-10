import React from "react";
import { render, screen } from "@testing-library/react";
import { GuestOrderTray, GuestTableOrder } from "./GuestTableOrder";

test("the menu does not show ordering without a guest token", () => {
  render(<GuestTableOrder item={{ id: "x", en: "Olives" }} />);
  render(<GuestOrderTray />);
  expect(screen.queryByRole("button", { name: "Add to order" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit for staff confirmation" })).not.toBeInTheDocument();
});
