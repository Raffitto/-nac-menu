import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MenuItemPlacementEditor from "./MenuItemPlacementEditor";

const categories = [
  { id: "breakfast", name_en: "Breakfast" },
  { id: "daytime", name_en: "Daytime" },
];

const sectionsCatalog = [
  { id: "breakfast-eggs", category_id: "breakfast", name_en: "Eggs" },
  { id: "breakfast-bakery", category_id: "breakfast", name_en: "Bakery" },
  { id: "daytime-mains", category_id: "daytime", name_en: "Mains" },
  { id: "daytime-salads", category_id: "daytime", name_en: "Salads" },
];

let rowCounter = 0;
function createRowKey() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

function PlacementHarness({ initialExtras = [] }) {
  const [primaryCategoryId, setPrimaryCategoryId] = useState("breakfast");
  const [primarySectionId, setPrimarySectionId] = useState("breakfast-eggs");
  const [extraPlacements, setExtraPlacements] = useState(initialExtras);
  const [removed, setRemoved] = useState([]);

  return (
    <div>
      <MenuItemPlacementEditor
        categories={categories}
        sectionsCatalog={sectionsCatalog}
        primaryCategoryId={primaryCategoryId}
        primarySectionId={primarySectionId}
        onPrimaryChange={({ category_id, section_id }) => {
          if (category_id !== undefined) setPrimaryCategoryId(category_id);
          if (section_id !== undefined) setPrimarySectionId(section_id);
        }}
        extraPlacements={extraPlacements}
        onExtraPlacementsChange={setExtraPlacements}
        onRemoveExtraPlacement={(index) => {
          const row = extraPlacements[index];
          if (row?.itemId) setRemoved((prev) => [...prev, row.itemId]);
          setExtraPlacements((prev) => prev.filter((_, i) => i !== index));
        }}
        onMoveExtraPlacement={(from, to) => {
          setExtraPlacements((prev) => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
          });
        }}
        createRowKey={createRowKey}
      />
      <div data-testid="primary-state">{`${primaryCategoryId}:${primarySectionId}`}</div>
      <div data-testid="extras-state">
        {extraPlacements
          .map((row) => `${row.category_id}:${row.section_id}`)
          .join("|")}
      </div>
      <div data-testid="removed-state">{removed.join(",")}</div>
    </div>
  );
}

describe("MenuItemPlacementEditor", () => {
  beforeEach(() => {
    rowCounter = 0;
  });

  test("renders primary chip and empty additional state", () => {
    render(<PlacementHarness />);
    expect(screen.getByTestId("primary-placement-chip")).toHaveTextContent(
      "Breakfast → Eggs",
    );
    expect(screen.getByText("Not shown in any other sections yet.")).toBeInTheDocument();
  });

  test("add placement opens inline picker and collapses into a chip on confirm", () => {
    render(<PlacementHarness />);
    fireEvent.click(screen.getByTestId("add-placement-button"));

    const picker = screen.getByTestId("add-placement-picker-panel");
    fireEvent.change(within(picker).getByTestId("add-placement-picker-category"), {
      target: { value: "daytime" },
    });
    fireEvent.change(within(picker).getByTestId("add-placement-picker-section"), {
      target: { value: "daytime-mains" },
    });
    fireEvent.click(within(picker).getByTestId("add-placement-picker-confirm"));

    expect(screen.getByTestId("extras-state")).toHaveTextContent("daytime:daytime-mains");
    expect(screen.getByText("Daytime → Mains")).toBeInTheDocument();
    expect(screen.queryByTestId("add-placement-picker-panel")).not.toBeInTheDocument();
  });

  test("category change updates section options for the add picker", () => {
    render(<PlacementHarness />);
    fireEvent.click(screen.getByTestId("add-placement-button"));

    const picker = screen.getByTestId("add-placement-picker-panel");
    const sectionSelect = within(picker).getByTestId("add-placement-picker-section");

    expect(sectionSelect).toBeDisabled();

    fireEvent.change(within(picker).getByTestId("add-placement-picker-category"), {
      target: { value: "daytime" },
    });

    expect(sectionSelect).not.toBeDisabled();
    expect(within(sectionSelect).getByText("Mains")).toBeInTheDocument();
    expect(within(sectionSelect).queryByText("Eggs")).not.toBeInTheDocument();
  });

  test("edit placement chip without closing the surrounding editor", () => {
    render(
      <PlacementHarness
        initialExtras={[
          {
            rowKey: "row-1",
            category_id: "daytime",
            section_id: "daytime-mains",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("placement-chip-row-1"));
    const picker = screen.getByTestId("edit-placement-picker-row-1-panel");
    fireEvent.change(within(picker).getByTestId("edit-placement-picker-row-1-section"), {
      target: { value: "daytime-salads" },
    });
    fireEvent.click(within(picker).getByTestId("edit-placement-picker-row-1-confirm"));

    expect(screen.getByTestId("extras-state")).toHaveTextContent("daytime:daytime-salads");
    expect(screen.getByText("Daytime → Salads")).toBeInTheDocument();
  });

  test("remove placement chip tracks removed linked item ids", () => {
    render(
      <PlacementHarness
        initialExtras={[
          {
            rowKey: "row-1",
            itemId: "linked-b",
            category_id: "daytime",
            section_id: "daytime-mains",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("placement-remove-row-1"));
    expect(screen.getByTestId("extras-state")).toHaveTextContent("");
    expect(screen.getByTestId("removed-state")).toHaveTextContent("linked-b");
  });

  test("reorder placements with chip controls", () => {
    render(
      <PlacementHarness
        initialExtras={[
          {
            rowKey: "row-1",
            category_id: "daytime",
            section_id: "daytime-mains",
          },
          {
            rowKey: "row-2",
            category_id: "daytime",
            section_id: "daytime-salads",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("placement-move-down-row-1"));
    expect(screen.getByTestId("extras-state")).toHaveTextContent(
      "daytime:daytime-salads|daytime:daytime-mains",
    );
  });

  test("prevents exact duplicate category and section pairs when adding", () => {
    render(<PlacementHarness />);
    fireEvent.click(screen.getByTestId("add-placement-button"));

    const picker = screen.getByTestId("add-placement-picker-panel");
    fireEvent.change(within(picker).getByTestId("add-placement-picker-category"), {
      target: { value: "breakfast" },
    });
    fireEvent.change(within(picker).getByTestId("add-placement-picker-section"), {
      target: { value: "breakfast-eggs" },
    });

    expect(screen.getByTestId("add-placement-picker-duplicate")).toBeInTheDocument();
    expect(screen.getByTestId("add-placement-picker-confirm")).toBeDisabled();
  });

  test("allows the same section label under a different category", () => {
    const sharedNameSections = [
      ...sectionsCatalog,
      { id: "dinner-eggs", category_id: "dinner", name_en: "Eggs" },
    ];

    function SharedLabelHarness() {
      const [extras, setExtras] = useState([]);
      return (
        <MenuItemPlacementEditor
          categories={[...categories, { id: "dinner", name_en: "Dinner" }]}
          sectionsCatalog={sharedNameSections}
          primaryCategoryId="breakfast"
          primarySectionId="breakfast-eggs"
          onPrimaryChange={() => {}}
          extraPlacements={extras}
          onExtraPlacementsChange={setExtras}
          onRemoveExtraPlacement={() => {}}
          onMoveExtraPlacement={() => {}}
          createRowKey={createRowKey}
        />
      );
    }

    render(<SharedLabelHarness />);
    fireEvent.click(screen.getByTestId("add-placement-button"));

    const picker = screen.getByTestId("add-placement-picker-panel");
    fireEvent.change(within(picker).getByTestId("add-placement-picker-category"), {
      target: { value: "dinner" },
    });
    fireEvent.change(within(picker).getByTestId("add-placement-picker-section"), {
      target: { value: "dinner-eggs" },
    });
    fireEvent.click(within(picker).getByTestId("add-placement-picker-confirm"));

    expect(screen.getByText("Dinner → Eggs")).toBeInTheDocument();
  });
});
