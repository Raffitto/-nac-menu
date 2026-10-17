import React from "react";
import { render, screen } from "@testing-library/react";
import FoodMenuCard from "./FoodMenuCard";

jest.mock("./ImpressionTracked", () => function MockImpressionTracked({ children, className }) {
  return <div className={className}>{children}</div>;
});

jest.mock("./MenuImage", () => function MockMenuImage() {
  return <img alt="" />;
});

describe("FoodMenuCard guest highlight styling", () => {
  const baseItem = {
    en: "Shakshuka",
    ar: "شكشوكة",
    calories: "420",
    price: "42 SAR",
    image: "",
    soldOut: false,
    featured: true,
  };

  test("applies featured styling and badge when highlighted", () => {
    const { container } = render(
      <FoodMenuCard
        menuItem={baseItem}
        categoryId="breakfast"
        sectionTitleEn="Eggs"
        sectionIndex={0}
        itemIndex={0}
        language="en"
        isArabic={false}
        enabled
        highlighted
        onOpenItem={() => {}}
      />,
    );

    expect(container.querySelector(".menu-card-featured")).toBeInTheDocument();
    expect(screen.getByText("Featured")).toBeInTheDocument();
  });

  test("keeps sold-out treatment for highlighted sold-out items", () => {
    const { container } = render(
      <FoodMenuCard
        menuItem={{ ...baseItem, soldOut: true }}
        categoryId="breakfast"
        sectionTitleEn="Eggs"
        sectionIndex={0}
        itemIndex={0}
        language="en"
        isArabic={false}
        enabled
        highlighted
        onOpenItem={() => {}}
      />,
    );

    expect(container.querySelector(".menu-card-featured")).toBeInTheDocument();
    expect(container.querySelector(".menu-card-sold-out")).toBeInTheDocument();
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });

  test("does not render featured styling when highlight is off", () => {
    const { container } = render(
      <FoodMenuCard
        menuItem={{ ...baseItem, featured: false }}
        categoryId="breakfast"
        sectionTitleEn="Eggs"
        sectionIndex={0}
        itemIndex={0}
        language="en"
        isArabic={false}
        enabled
        onOpenItem={() => {}}
      />,
    );

    expect(container.querySelector(".menu-card-featured")).not.toBeInTheDocument();
    expect(container.querySelector(".menu-card-collage")).not.toBeInTheDocument();
    expect(screen.queryByText("Featured")).not.toBeInTheDocument();
  });

  test("2 Eggs Any Style uses one three-photo collage and other dishes do not", () => {
    const eggs = {
      en: "2 Eggs Any Style",
      ar: "٢ بيض من أي نوع",
      calories: 461.4,
      price: "31 SAR",
      image: "/2-eggs.jpg",
      preparations: [
        { id: "fried", image: "/eggs-fried-menu.webp" },
        { id: "scrambled", image: "/eggs-scrambled.webp" },
        { id: "poached", image: "/eggs-poached.webp" },
      ],
    };
    const { container, rerender } = render(
      <FoodMenuCard
        menuItem={eggs}
        categoryId="brunch"
        sectionTitleEn="Eggs"
        sectionIndex={1}
        itemIndex={0}
        language="en"
        isArabic={false}
        enabled
        onOpenItem={() => {}}
      />,
    );
    expect([...container.querySelectorAll(".menu-card-collage img")].map((img) => img.getAttribute("src"))).toEqual([
      "/eggs-fried-menu.webp",
      "/eggs-scrambled.webp",
      "/eggs-poached.webp",
    ]);
    expect(screen.getByText("31 SAR")).toBeInTheDocument();
    expect(screen.getByText("461.4 cal")).toBeInTheDocument();

    rerender(
      <FoodMenuCard
        menuItem={{ en: "Scrambled Eggs", ar: "بيض مخفوق", calories: 751, price: "49 SAR", image: "/scrambled-eggs.jpg" }}
        categoryId="brunch"
        sectionTitleEn="Eggs"
        sectionIndex={1}
        itemIndex={1}
        language="en"
        isArabic={false}
        enabled
        onOpenItem={() => {}}
      />,
    );
    expect(container.querySelector(".menu-card-collage")).not.toBeInTheDocument();
  });
});
