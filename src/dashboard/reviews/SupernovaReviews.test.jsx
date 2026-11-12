import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import SupernovaReviews from "./SupernovaReviews";
import { supabase } from "../../lib/supabase";

jest.mock("../../lib/supabase", () => ({ supabase: { rpc: jest.fn() } }));

test("shows isolated Supernova scan totals and labels scans honestly", async () => {
  supabase.rpc.mockResolvedValue({
    data: {
      total_scans: 8,
      today_scans: 2,
      last_7_days: 5,
      last_30_days: 8,
      approximate_unique_scans: 6,
      repeat_scans: 2,
      daily_history: [{ date: "2026-11-12", scans: 2 }],
    },
    error: null,
  });

  render(<SupernovaReviews />);
  await waitFor(() => expect(screen.getAllByText("8")).toHaveLength(2));
  expect(supabase.rpc).toHaveBeenCalledWith("get_supernova_scan_summary", { p_days: 30 });
  expect(screen.getByText("Approx. unique")).toBeInTheDocument();
  expect(screen.getByText("Repeat scans")).toBeInTheDocument();
  expect(screen.getByText(/not confirmed Google review submissions/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Download print card/ })).toHaveAttribute("href", "/supernova-review-card.pdf");
  expect(screen.getByRole("img", { name: "Supernova Google review QR code" })).toHaveAttribute("src", "/supernova-review-qr.png");
});
