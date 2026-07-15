import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import MenuAddItemModal from "./MenuAddItemModal";

const destination = {
  sectionId: "daytime-eggs",
  sectionName: "Eggs",
  categoryId: "daytime",
  categoryName: "Daytime",
};

const catalogue = [
  {
    dedupeKey: "group-1",
    id: "item-a",
    name_en: "Shakshuka",
    image: "",
    price: "42 SAR",
    active: true,
    sold_out: false,
    primaryLocationLabel: "Breakfast → Eggs",
    placedSectionIds: ["breakfast-eggs"],
    row: { id: "item-a", section_id: "breakfast-eggs" },
  },
  {
    dedupeKey: "item-c",
    id: "item-c",
    name_en: "Avocado Toast",
    image: "",
    price: "36 SAR",
    active: true,
    sold_out: true,
    primaryLocationLabel: "Breakfast → Eggs",
    placedSectionIds: ["breakfast-eggs", "daytime-eggs"],
    row: { id: "item-c", section_id: "breakfast-eggs" },
  },
];

describe("MenuAddItemModal", () => {
  test("offers create-new and add-existing choices for the destination section", () => {
    const onChooseCreateNew = jest.fn();
    render(
      <MenuAddItemModal
        open
        destination={destination}
        catalogue={catalogue}
        onClose={() => {}}
        onChooseCreateNew={onChooseCreateNew}
        onConfirmExisting={() => {}}
      />,
    );

    expect(screen.getByText(/Daytime/)).toBeInTheDocument();
    expect(screen.getByText(/Eggs/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-new-item-choice"));
    expect(onChooseCreateNew).toHaveBeenCalled();
  });

  test("supports searching and multi-selecting available catalogue items", () => {
    const onConfirmExisting = jest.fn();
    const onOpenExisting = jest.fn();

    render(
      <MenuAddItemModal
        open
        destination={destination}
        catalogue={catalogue}
        onClose={() => {}}
        onOpenExisting={onOpenExisting}
        onChooseCreateNew={() => {}}
        onConfirmExisting={onConfirmExisting}
      />,
    );

    fireEvent.click(screen.getByTestId("add-existing-item-choice"));
    expect(onOpenExisting).toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("add-existing-item-search"), {
      target: { value: "shak" },
    });
    fireEvent.click(screen.getByTestId("catalogue-row-group-1"));
    expect(screen.getByTestId("confirm-add-existing-items")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("confirm-add-existing-items"));
    expect(onConfirmExisting).toHaveBeenCalledWith([
      expect.objectContaining({ dedupeKey: "group-1" }),
    ]);
  });

  test("disables items already placed in the destination section", () => {
    render(
      <MenuAddItemModal
        open
        destination={destination}
        catalogue={catalogue}
        onClose={() => {}}
        onChooseCreateNew={() => {}}
        onConfirmExisting={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("add-existing-item-choice"));
    expect(screen.getByTestId("catalogue-row-placed-item-c")).toBeInTheDocument();
    expect(screen.getByText("Already here")).toBeInTheDocument();
  });
});
