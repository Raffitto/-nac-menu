import React from "react";
import { render, screen } from "@testing-library/react";
import ContextualMenuView from "./ContextualMenuView";

jest.mock("./GuestFeaturedSection", () => function MockGuestFeaturedSection({ items }) {
  if (!items.length) return null;
  return <div data-testid="guest-featured-section">{items.map((item) => item.en).join(", ")}</div>;
});

jest.mock("./FoodMenuCard", () => function MockFoodMenuCard() {
  return <div data-testid="food-card" />;
});

jest.mock("./DrinkMenuCard", () => function MockDrinkMenuCard() {
  return <div data-testid="drink-card" />;
});

jest.mock("./MenuSkeleton", () => function MockMenuSkeleton() {
  return <div data-testid="menu-skeleton" />;
});

const categories = [
  { id: "breakfast", en: "Breakfast", ar: "فطور", timeEn: "", timeAr: "", icon: "" },
];

const menuData = {
  breakfast: [
    {
      title: { en: "Eggs", ar: "بيض" },
      items: [
        {
          id: "item-1",
          en: "Shakshuka",
          ar: "شكشوكة",
          featured: true,
          soldOut: false,
          allergens: [],
          tags: [],
        },
        {
          id: "item-2",
          en: "Toast",
          ar: "توست",
          featured: false,
          soldOut: false,
          allergens: [],
          tags: [],
        },
      ],
    },
  ],
};

describe("ContextualMenuView featured rendering", () => {
  test("shows the recommended section when highlighted items are available", () => {
    render(
      <ContextualMenuView
        categoryIds={["breakfast"]}
        isManualMode={false}
        categories={categories}
        menuData={menuData}
        activeCategory="breakfast"
        setActiveCategory={() => {}}
        isArabic={false}
        lang="en"
        search=""
        isAllowed={() => true}
        onOpenItem={() => {}}
        loading={false}
      />,
    );

    expect(screen.getByTestId("guest-featured-section")).toHaveTextContent("Shakshuka");
  });

  test("hides the recommended section when no highlighted items pass filters", () => {
    render(
      <ContextualMenuView
        categoryIds={["breakfast"]}
        isManualMode={false}
        categories={categories}
        menuData={menuData}
        activeCategory="breakfast"
        setActiveCategory={() => {}}
        isArabic={false}
        lang="en"
        search="toast"
        isAllowed={() => true}
        onOpenItem={() => {}}
        loading={false}
      />,
    );

    expect(screen.queryByTestId("guest-featured-section")).not.toBeInTheDocument();
  });
});
