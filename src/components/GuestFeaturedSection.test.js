import React from "react";
import { render, screen } from "@testing-library/react";
import GuestFeaturedSection from "./GuestFeaturedSection";

jest.mock("./FoodMenuCard", () => function MockFoodMenuCard(props) {
  return (
    <div
      data-testid={`food-card-${props.menuItem.id}`}
      data-highlighted={props.highlighted ? "true" : "false"}
      data-sold-out={props.menuItem.soldOut ? "true" : "false"}
    >
      {props.menuItem.en}
    </div>
  );
});

jest.mock("./DrinkMenuCard", () => function MockDrinkMenuCard() {
  return <div data-testid="drink-card" />;
});

const items = [
  {
    id: "featured-1",
    en: "Shakshuka",
    featured: true,
    soldOut: false,
    categoryId: "breakfast",
    sectionTitleEn: "Eggs",
  },
  {
    id: "featured-2",
    en: "Sumac Chicken",
    featured: true,
    soldOut: true,
    categoryId: "daytime",
    sectionTitleEn: "Mains",
  },
];

describe("GuestFeaturedSection", () => {
  test("renders the recommended section only when highlighted items exist", () => {
    const { rerender } = render(
      <GuestFeaturedSection
        items={items}
        isArabic={false}
        lang="en"
        onOpenItem={() => {}}
      />,
    );

    expect(screen.getByTestId("guest-featured-section")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByTestId("food-card-featured-1")).toBeInTheDocument();
    expect(screen.getByTestId("food-card-featured-2")).toHaveAttribute(
      "data-sold-out",
      "true",
    );

    rerender(
      <GuestFeaturedSection
        items={[]}
        isArabic={false}
        lang="en"
        onOpenItem={() => {}}
      />,
    );
    expect(screen.queryByTestId("guest-featured-section")).not.toBeInTheDocument();
  });

  test("passes highlighted styling through to guest cards", () => {
    render(
      <GuestFeaturedSection
        items={[items[0]]}
        isArabic={false}
        lang="en"
        onOpenItem={() => {}}
      />,
    );

    expect(screen.getByTestId("food-card-featured-1")).toHaveAttribute(
      "data-highlighted",
      "true",
    );
  });
});
