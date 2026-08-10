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

  test("mobile Ask NAC styles avoid chat-height jail and keep sticky composer clearance", () => {
    const css = require("fs").readFileSync(
      require("path").join(__dirname, "../styles/ask-nac.css"),
      "utf8",
    );
    const mobileCss = require("fs").readFileSync(
      require("path").join(__dirname, "../styles/intelligence-mobile.css"),
      "utf8",
    );
    expect(css).toMatch(/\.nac-ask-nac-chat--page/);
    expect(css).toMatch(/max-height:\s*none/);
    expect(css).toMatch(/position:\s*sticky/);
    expect(css).toMatch(/safe-area-inset-bottom/);
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    // Phone styles must not reintroduce a tall fixed chat jail
    expect(css).not.toMatch(/min-height:\s*min\(calc\(100dvh/);
    expect(css).toMatch(/overflow-x:\s*hidden/);
    expect(css).toMatch(/nac-ask-nac-suggestions__track[\s\S]*overflow-x:\s*auto/);
    // Mobile fullscreen chat body must not keep an internal overflow scroller
    expect(css).toMatch(/\.nac-ask-nac-mobile__body\s*\{[^}]*overflow:\s*visible/s);
    expect(css).not.toMatch(/\.nac-ask-nac-mobile__body\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.nac-ask-nac-mobile__footer\s*\{[^}]*position:\s*sticky/s);
    expect(mobileCss).toMatch(/nac-intelligence-hub--ask[\s\S]*overflow:\s*visible/);

    const { container } = render(<AskNacTab showVaultPanel={false} />);
    const chat = screen.getByTestId("ask-nac-chat-page");
    expect(chat).toHaveClass("nac-ask-nac-chat--page");
    expect(container.querySelector(".nac-ask-nac-composer")).toBeTruthy();
    expect(container.querySelector(".nac-ask-nac-workspace__column")).toBeTruthy();
  });
});
