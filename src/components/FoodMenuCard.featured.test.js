import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import FoodMenuCard from "./FoodMenuCard";

jest.mock("./ImpressionTracked", () => function MockImpressionTracked({ children, className, onClick }) {
  return <div className={className} onClick={onClick}>{children}</div>;
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

  test("2 Eggs Any Style collage keeps fried on the left and opens the clicked preparation", () => {
    const eggs = {
      en: "2 Eggs Any Style",
      ar: "٢ بيض من أي نوع",
      calories: 461.4,
      price: "31 SAR",
      image: "/2-eggs.jpg",
      preparations: [
        { id: "fried", en: "Fried", ar: "مقلي", image: "/eggs-fried-menu.webp" },
        { id: "scrambled", en: "Scrambled", ar: "مخفوق", image: "/eggs-scrambled.webp" },
        { id: "poached", en: "Poached", ar: "مسلوق", image: "/eggs-poached.webp" },
      ],
    };
    const onOpenItem = jest.fn();
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
        onOpenItem={onOpenItem}
      />,
    );
    expect(container.querySelector(".menu-card-collage")).toHaveAttribute("dir", "ltr");
    expect(container.querySelector(".menu-card-collage__shot--fried img")).toHaveAttribute("src", "/eggs-fried-menu.webp");
    expect(container.querySelector(".menu-card-collage__shot--scrambled img")).toHaveAttribute("src", "/eggs-scrambled.webp");
    expect(container.querySelector(".menu-card-collage__shot--poached img")).toHaveAttribute("src", "/eggs-poached.webp");
    expect(screen.getByText("31 SAR")).toBeInTheDocument();
    expect(screen.getByText("461.4 cal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2 Eggs Any Style, Fried" }));
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    expect(onOpenItem).toHaveBeenCalledWith(eggs, "Eggs", "brunch", "fried");

    fireEvent.click(screen.getByRole("button", { name: "2 Eggs Any Style, Poached" }));
    expect(onOpenItem).toHaveBeenLastCalledWith(eggs, "Eggs", "brunch", "poached");

    fireEvent.click(screen.getByRole("heading", { name: "2 Eggs Any Style" }));
    expect(onOpenItem).toHaveBeenLastCalledWith(eggs, "Eggs", "brunch");

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
