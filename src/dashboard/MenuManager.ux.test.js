import React from "react";
import fs from "fs";
import path from "path";
import { fireEvent, render, screen } from "@testing-library/react";
import MenuManagerOnboarding from "./MenuManagerOnboarding";
import MenuPublishStatusBar from "./MenuPublishStatusBar";
import MenuManagerTooltip from "./MenuManagerTooltip";
import MenuAddItemModal from "./MenuAddItemModal";
import {
  ONBOARDING_STORAGE_KEY,
  buildEditorSnapshot,
  formatRelativeTimestamp,
  friendlyPublishErrorMessage,
  friendlyActionErrorMessage,
  formatLastPublishedLabel,
  isOnboardingDismissed,
  persistOnboardingDismissed,
  resolvePublishBarState,
  snapshotsEqual,
} from "./menuManagerUx";
import { MENU_PUBLISH_STAGES } from "../lib/menuApi";

describe("menuManagerUx helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("onboarding persistence is local-only", () => {
    expect(isOnboardingDismissed()).toBe(false);
    persistOnboardingDismissed(false);
    expect(isOnboardingDismissed()).toBe(false);
    persistOnboardingDismissed(true);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe("1");
    expect(isOnboardingDismissed()).toBe(true);
  });

  test("resolvePublishBarState covers live, waiting, publishing, and failed", () => {
    expect(
      resolvePublishBarState({
        publishStage: null,
        publishStatus: { sync_status: "healthy" },
        retryPublish: null,
        publishInFlight: false,
      }),
    ).toBe("live");

    expect(
      resolvePublishBarState({
        publishStage: null,
        publishStatus: { sync_status: "needs_publish" },
        retryPublish: null,
        publishInFlight: false,
      }),
    ).toBe("waiting");

    expect(
      resolvePublishBarState({
        publishStage: MENU_PUBLISH_STAGES.PUBLISHING,
        publishStatus: { sync_status: "healthy" },
        retryPublish: null,
        publishInFlight: true,
      }),
    ).toBe("publishing");

    expect(
      resolvePublishBarState({
        publishStage: MENU_PUBLISH_STAGES.FAILED,
        publishStatus: { sync_status: "healthy" },
        retryPublish: { changeSummary: { action: "retry_publish" } },
        publishInFlight: false,
      }),
    ).toBe("failed");
  });

  test("friendlyActionErrorMessage hides technical database errors", () => {
    expect(
      friendlyActionErrorMessage({
        message: 'duplicate key value violates unique constraint "menu_publications_branch_id_version_key"',
      }),
    ).toBe("Something went wrong. Please try again.");
  });

  test("formatLastPublishedLabel formats guest menu timestamps", () => {
    const label = formatLastPublishedLabel("2026-07-16T12:00:00.000Z");
    expect(label).toMatch(/16/);
  });

  test("formatRelativeTimestamp returns human-readable recency", () => {
    const now = Date.now();
    expect(formatRelativeTimestamp(now - 6000, now)).toBe("Updated 6 seconds ago.");
    expect(formatRelativeTimestamp(now, now)).toBe("Updated just now.");
  });

  test("editor snapshots detect unsaved changes", () => {
    const base = buildEditorSnapshot({
      editingItem: { name_en: "Toast" },
      itemAllergenIds: [],
      itemAddOnIds: [],
      extraPlacements: [],
      imageFile: null,
      removedPlacementIds: [],
    });
    const changed = buildEditorSnapshot({
      editingItem: { name_en: "Changed" },
      itemAllergenIds: [],
      itemAddOnIds: [],
      extraPlacements: [],
      imageFile: null,
      removedPlacementIds: [],
    });
    expect(snapshotsEqual(base, base)).toBe(true);
    expect(snapshotsEqual(base, changed)).toBe(false);
  });
});

describe("MenuManagerOnboarding", () => {
  beforeEach(() => localStorage.clear());

  test("shows welcome steps and dismisses with optional persistence", () => {
    const onDismiss = jest.fn();
    render(<MenuManagerOnboarding onDismiss={onDismiss} />);

    expect(screen.getByText("Welcome to Menu Management")).toBeInTheDocument();
    expect(screen.getByText(/Choose the destination section/i)).toBeInTheDocument();
    expect(screen.getByText(/Breakfast → Eggs/i)).toBeInTheDocument();
    expect(screen.getByText(/Press \+ Add Item/i)).toBeInTheDocument();
    expect(screen.getByText(/status bar at the top/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("onboarding-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
    expect(isOnboardingDismissed()).toBe(false);

    fireEvent.click(screen.getByTestId("onboarding-dont-show-again"));
    fireEvent.click(screen.getByTestId("onboarding-dismiss"));
    expect(isOnboardingDismissed()).toBe(true);
  });
});

describe("MenuPublishStatusBar", () => {
  test("renders live, waiting, publishing, and failed states with actions", () => {
    const onPublish = jest.fn();
    const onRetry = jest.fn();

    const { rerender } = render(
      <MenuPublishStatusBar
        state="live"
        friendlyError=""
        publishing={false}
        onPublish={onPublish}
        onRetry={onRetry}
        liveMenuUrl="https://example.com/khobar"
        readOnly={false}
        lastPublishedLabel="16 Jul, 14:30"
      />,
    );
    expect(screen.getByText(/Guest menu is up to date/i)).toBeInTheDocument();
    expect(screen.getByTestId("publish-last-updated")).toHaveTextContent("16 Jul, 14:30");

    rerender(
      <MenuPublishStatusBar
        state="waiting"
        friendlyError=""
        publishing={false}
        onPublish={onPublish}
        onRetry={onRetry}
        liveMenuUrl="https://example.com/khobar"
        readOnly={false}
        pendingChangeCount={3}
      />,
    );
    expect(screen.getByText(/Changes waiting/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("publish-menu-button"));
    expect(onPublish).toHaveBeenCalled();

    rerender(
      <MenuPublishStatusBar
        state="publishing"
        friendlyError=""
        publishing
        onPublish={onPublish}
        onRetry={onRetry}
        liveMenuUrl="https://example.com/khobar"
        readOnly={false}
      />,
    );
    expect(screen.getByTestId("menu-publish-status-bar")).toHaveTextContent("Publishing…");
    expect(screen.getByTestId("publish-menu-button")).toBeDisabled();

    rerender(
      <MenuPublishStatusBar
        state="failed"
        friendlyError="We couldn't update the guest menu. Please try again."
        publishing={false}
        onPublish={onPublish}
        onRetry={onRetry}
        liveMenuUrl="https://example.com/khobar"
        readOnly={false}
      />,
    );
    expect(screen.getByText(/Publish failed/i)).toBeInTheDocument();
    expect(screen.getByTestId("publish-friendly-error")).toHaveTextContent(
      "We couldn't update the guest menu. Please try again.",
    );
    fireEvent.click(screen.getByTestId("retry-publish-button"));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("MenuManagerTooltip", () => {
  test("renders accessible tooltip copy", () => {
    render(
      <MenuManagerTooltip label="Save all menu changes to the live guest menu.">
        <button type="button">Publish</button>
      </MenuManagerTooltip>,
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Save all menu changes to the live guest menu.",
    );
  });
});

describe("MenuAddItemModal search UX", () => {
  const destination = {
    sectionId: "sec-1",
    sectionName: "Eggs",
    categoryId: "cat-1",
    categoryName: "Breakfast",
  };

  test("shows no-results state with clear search action", () => {
    render(
      <MenuAddItemModal
        open
        destination={destination}
        catalogue={[
          {
            dedupeKey: "a",
            id: "item-a",
            name_en: "Pancakes",
            image: "",
            price: "30 SAR",
            active: true,
            sold_out: false,
            primaryLocationLabel: "Breakfast → Eggs",
            placedSectionIds: [],
            row: { id: "item-a", section_id: "other" },
          },
        ]}
        onClose={() => {}}
        onChooseCreateNew={() => {}}
        onConfirmExisting={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("add-existing-item-choice"));
    fireEvent.change(screen.getByTestId("add-existing-item-search"), {
      target: { value: "zzz" },
    });
    expect(screen.getByTestId("catalogue-search-empty")).toBeInTheDocument();
    expect(screen.getByText("No matching menu items.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("clear-catalogue-search"));
    expect(screen.getByTestId("add-existing-item-search")).toHaveValue("");
  });

  test("choice buttons expose tooltip labels", () => {
    render(
      <MenuAddItemModal
        open
        destination={destination}
        catalogue={[]}
        onClose={() => {}}
        onChooseCreateNew={() => {}}
        onConfirmExisting={() => {}}
      />,
    );
    expect(screen.getAllByRole("tooltip").length).toBeGreaterThanOrEqual(2);
  });
});

describe("MenuManager UX integration contract", () => {
  const componentSource = fs.readFileSync(
    path.join(path.resolve(__dirname), "MenuManager.jsx"),
    "utf8",
  );

  test("wires onboarding, status bar, unsaved changes, and manager-friendly copy", () => {
    expect(componentSource).toContain('lazy(() => import("./MenuManagerOnboarding"))');
    expect(componentSource).toContain("MenuPublishStatusBar");
    expect(componentSource).toContain('data-testid="unsaved-changes-indicator"');
    expect(componentSource).toContain('data-testid="section-empty-state"');
    expect(componentSource).toContain('data-testid="menu-search-empty"');
    expect(componentSource).toContain('data-testid="recommended-preview-badge"');
    expect(componentSource).toContain('data-testid="section-create-form"');
    expect(componentSource).toContain("Delete menu item?");
    expect(componentSource).toContain("Linked placements will also be removed.");
    expect(componentSource).toContain("✓ Menu item saved.");
    expect(componentSource).toContain("Save to guest menu");
    expect(componentSource).toContain("friendlyPublishErrorMessage");
    expect(componentSource).toContain("beforeunload");
    expect(componentSource).not.toContain("prompt(");
  });
});
