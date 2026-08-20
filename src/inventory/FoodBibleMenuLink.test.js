import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import FoodBibleMenuLink from "./FoodBibleMenuLink";

describe("FoodBibleMenuLink", () => {
  const identities = [
    {
      id: "a",
      name: "Scrambled Eggs",
      nameAr: "بيض",
      categoryName: "Brunch",
      sectionName: "Eggs",
      placements: "Brunch · Daytime",
      status: "Live",
    },
    {
      id: "b",
      name: "2 Eggs Any Style",
      categoryName: "Brunch",
      sectionName: "Eggs",
      placements: "Brunch",
      status: "Live",
    },
  ];

  test("requires an explicit confirm and shows the current link", () => {
    const onConfirm = jest.fn();
    render(
      <FoodBibleMenuLink
        open
        currentRecipeName="TURKISH EGGS, CAJUN BUTTER, PITA"
        currentLinkName="Turkish Eggs"
        identities={identities}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId("food-bible-menu-link")).toHaveTextContent("currently linked");
    fireEvent.click(screen.getByTestId("food-bible-menu-link-option-b"));
    fireEvent.click(screen.getByTestId("food-bible-menu-link-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: "b", name: "2 Eggs Any Style" }));
  });

  test("search distinguishes similarly named egg dishes", () => {
    render(
      <FoodBibleMenuLink
        open
        currentRecipeName="Scrambled eggs sandwich"
        identities={identities}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("food-bible-menu-link-search"), { target: { value: "any style" } });
    expect(screen.getByTestId("food-bible-menu-link-option-b")).toBeInTheDocument();
    expect(screen.queryByTestId("food-bible-menu-link-option-a")).not.toBeInTheDocument();
  });
});
