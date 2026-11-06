import React from "react";
import { render, screen } from "@testing-library/react";
import BranchBattle from "./BranchBattle";
import { useReviewIntelligenceData } from "../hooks/useReviewIntelligenceData";

jest.mock("../hooks/useReviewIntelligenceData", () => ({ useReviewIntelligenceData: jest.fn() }));
jest.mock("../hooks/useGooglePlaceMetrics", () => ({ useGooglePlaceMetrics: () => ({ loading: false, byBranch: {} }) }));
jest.mock("../hooks/usePredictiveIntelligence", () => ({ usePredictiveIntelligence: () => ({ pkg: null }) }));
jest.mock("../context/PlatformFiltersContext", () => ({ usePlatformFiltersOptional: () => ({ selectedRange: "month" }) }));
jest.mock("../components/GoogleReputationBadge", () => () => null);
jest.mock("../components/PredictiveIntelligenceVisuals", () => ({ OperationalScoreBadge: () => null }));
jest.mock("framer-motion", () => ({ motion: { div: ({ children, ...props }) => <div>{children}</div> } }));

const rows = [
  { branch_id: "khobar", qr_scans: 1200, reviews_generated: 90, google_redirects: 850, conversion_pct: 70.8 },
  { branch_id: "riyadh", qr_scans: 950, reviews_generated: 70, google_redirects: 600, conversion_pct: 63.2 },
  { branch_id: "jeddah", qr_scans: 1100, reviews_generated: 80, google_redirects: 700, conversion_pct: 63.6 },
  { branch_id: "hettin", qr_scans: 20, reviews_generated: 3, google_redirects: 12, conversion_pct: 60 },
];

it("renders complete period totals from the Performance reporting hook across all four branches", () => {
  useReviewIntelligenceData.mockReturnValue({ branchComparison: rows, loading: false, error: "", partial: false });
  render(<BranchBattle />);
  expect(screen.getByText("NAC Khobar")).toBeInTheDocument();
  expect(screen.getByText("NAC Laysen Valley")).toBeInTheDocument();
  expect(screen.getByText("NAC Jeddah")).toBeInTheDocument();
  expect(screen.getByText("NAC Hettin")).toBeInTheDocument();
  expect(screen.getByText("1200")).toBeInTheDocument();
  expect(screen.getByText("950")).toBeInTheDocument();
});

it("renders only authorized rows supplied by the shared reporting source", () => {
  useReviewIntelligenceData.mockReturnValue({ branchComparison: [rows[1]], loading: false, error: "", partial: false });
  render(<BranchBattle />);
  expect(screen.getByText("NAC Laysen Valley")).toBeInTheDocument();
  expect(screen.queryByText("NAC Khobar")).not.toBeInTheDocument();
  expect(screen.queryByText("NAC Hettin")).not.toBeInTheDocument();
});

it("never presents incomplete fallback totals as a finished comparison", () => {
  useReviewIntelligenceData.mockReturnValue({ branchComparison: [rows[0]], loading: false, error: "", partial: true });
  render(<BranchBattle />);
  expect(screen.getByRole("alert")).toHaveTextContent("Complete Branch Battle totals are unavailable");
  expect(screen.queryByText("1200")).not.toBeInTheDocument();
});
