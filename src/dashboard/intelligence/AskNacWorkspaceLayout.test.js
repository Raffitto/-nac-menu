import React from "react";
import { render, screen } from "@testing-library/react";
import AskNacTab from "./AskNacTab";
import IntelligenceTabPanels from "./IntelligenceTabPanels";
import { resolveAskNacSuggestions } from "./askNacChatUtils";

jest.mock("../../lib/supabase", () => ({
  supabase: null,
  isSupabaseConfigured: () => false,
}));

jest.mock("./useAskNacConnectionStatus", () => ({
  useAskNacConnectionStatus: () => ({
    tone: "local",
    label: "Local",
    shortLabel: "Local",
  }),
}));

jest.mock("../context/PlatformFiltersContext", () => ({
  usePlatformFiltersOptional: () => ({
    branch: "khobar",
    selectedRange: "today",
    timeRangeHours: 24,
  }),
}));

jest.mock("../context/RbacContext", () => ({
  useRbacOptional: () => ({ session: null }),
}));

jest.mock("./AskNacDataVaultPanel", () => () => (
  <div data-testid="company-knowledge-panel">Company Knowledge panel</div>
));

jest.mock("./KnowledgeTab", () => () => (
  <div data-testid="intelligence-knowledge-tab">Company Knowledge panel</div>
));

describe("Ask NAC workspace vs Knowledge separation", () => {
  test("Ask NAC view does not render Company Knowledge underneath it", () => {
    render(<IntelligenceTabPanels activeTab="ask" />);
    expect(screen.getByTestId("intelligence-ask-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("company-knowledge-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("intelligence-knowledge-tab")).not.toBeInTheDocument();
  });

  test("Knowledge subview renders Company Knowledge", async () => {
    render(<IntelligenceTabPanels activeTab="knowledge" />);
    expect(await screen.findByTestId("intelligence-knowledge-tab")).toBeInTheDocument();
    expect(screen.getByText("Company Knowledge panel")).toBeInTheDocument();
  });

  test("Ask NAC uses page-level chat shell without fixed internal scroll jail", () => {
    const { container } = render(<AskNacTab showVaultPanel={false} />);
    expect(screen.getByTestId("ask-nac-workspace")).toBeInTheDocument();
    const chat = screen.getByTestId("ask-nac-chat-page");
    expect(chat).toHaveClass("nac-ask-nac-chat--page");
    expect(chat.className).not.toMatch(/overflow-y-auto/);
    // Nested message list must not be a fixed-height overflow jail
    const messages = container.querySelector(".nac-ask-nac-chat__messages");
    expect(messages).toBeNull(); // empty conversation → no message list yet
    expect(screen.getByLabelText("Ask NAC a question")).toBeInTheDocument();
  });

  test("composer remains available on Ask NAC", () => {
    render(<AskNacTab />);
    expect(screen.getByRole("button", { name: /send question/i })).toBeInTheDocument();
  });

  test("suggestions hide once conversation has messages", () => {
    const prompts = [
      { text: "A", icon: null },
      { text: "B", icon: null },
    ];
    expect(
      resolveAskNacSuggestions({
        messageCount: 0,
        allPrompts: prompts,
        maxSuggestions: 8,
      }),
    ).toHaveLength(2);
    expect(
      resolveAskNacSuggestions({
        messageCount: 2,
        allPrompts: prompts,
        maxSuggestions: 8,
      }),
    ).toHaveLength(0);
  });
});
