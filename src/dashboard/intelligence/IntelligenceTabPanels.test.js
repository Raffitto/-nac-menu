import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import IntelligenceTabPanels from "./IntelligenceTabPanels";

jest.mock("./AskNacTab", () => () => <div>Ask NAC panel</div>);
jest.mock("./SalesIntelligenceHub", () => () => <div>Sales panel</div>);
jest.mock("./MenuIntelligence", () => () => <div>Menu panel</div>);
jest.mock("./CompetitiveReputationWatch", () => () => <div>Competitors panel</div>);
jest.mock("./OperationsInsights", () => () => <div>Diagnostics panel</div>);
jest.mock("./ExecutiveCommandCenter", () => () => <div>Operations overview panel</div>);
jest.mock("./VisualIntelligenceEngine", () => () => <div>Visual panel</div>);
jest.mock("../RestaurantIntelligence", () => () => <div>Staff reviews panel</div>);

describe("IntelligenceTabPanels taxonomy", () => {
  test("Ask NAC remains unchanged", () => {
    render(<IntelligenceTabPanels activeTab="ask" />);
    expect(screen.getByText("Ask NAC panel")).toBeInTheDocument();
  });

  test("Operations exposes merged operational views", async () => {
    const { rerender } = render(
      <IntelligenceTabPanels activeTab="operations" secondaryTab="overview" />,
    );
    await waitFor(() => {
      expect(screen.getByText("Operations overview panel")).toBeInTheDocument();
    });

    rerender(<IntelligenceTabPanels activeTab="operations" secondaryTab="staff" />);
    await waitFor(() => {
      expect(screen.getByText("Staff reviews panel")).toBeInTheDocument();
    });

    rerender(<IntelligenceTabPanels activeTab="operations" secondaryTab="diagnostics" />);
    expect(screen.getByText("Diagnostics panel")).toBeInTheDocument();
  });

  test("Commercial exposes Sales and Menu views", () => {
    const { rerender } = render(
      <IntelligenceTabPanels activeTab="commercial" secondaryTab="sales" />,
    );
    expect(screen.getByText("Sales panel")).toBeInTheDocument();

    rerender(<IntelligenceTabPanels activeTab="commercial" secondaryTab="menu" />);
    expect(screen.getByText("Menu panel")).toBeInTheDocument();
  });

  test("Market exposes Visual and Competitors views", async () => {
    const { rerender } = render(
      <IntelligenceTabPanels activeTab="market" secondaryTab="visual" />,
    );
    await waitFor(() => {
      expect(screen.getByText("Visual panel")).toBeInTheDocument();
    });

    rerender(<IntelligenceTabPanels activeTab="market" secondaryTab="competitors" />);
    expect(screen.getByText("Competitors panel")).toBeInTheDocument();
  });
});
