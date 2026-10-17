import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EggPreparationPicker from "./EggPreparationPicker";
import { selectEggPreparation, withEggPreparations } from "../lib/eggPreparation";

function Harness() {
  const [item, setItem] = useState(() => withEggPreparations({
    en: "2 Eggs Any Style",
    price: "31 SAR",
    calories: 461.4,
    image: "/2-eggs.jpg",
  }));
  return (
    <>
      <img alt="hero" src={item.preparationSelection.image} />
      <EggPreparationPicker
        selectedId={item.selectedPreparationId}
        onSelect={(optionId) => setItem(selectEggPreparation(item, optionId))}
      />
    </>
  );
}

test("thumbnail click updates the selected preparation and photograph", async () => {
  render(<Harness />);
  expect(screen.getByRole("radio", { name: "Scrambled" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByAltText("hero")).toHaveAttribute("src", "/eggs-scrambled.webp");
  await userEvent.click(screen.getByRole("radio", { name: "Poached" }));
  expect(screen.getByRole("radio", { name: "Poached" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByAltText("hero")).toHaveAttribute("src", "/eggs-poached.webp");
  screen.getByRole("radio", { name: "Poached" }).focus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(screen.getByRole("radio", { name: "Scrambled" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByAltText("hero")).toHaveAttribute("src", "/eggs-scrambled.webp");
});
