import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import FoodBiblePhotoEditor from "./FoodBiblePhotoEditor";

function Harness({ initialPhoto = "" }) {
  const [photo, setPhoto] = useState(initialPhoto);
  const [crop, setCrop] = useState({ x: 50, y: 50, zoom: 1, fit: "fill" });
  return (
    <FoodBiblePhotoEditor
      photo={photo}
      crop={crop}
      editing
      busy=""
      onCropChange={(patch) => setCrop((current) => ({ ...current, ...patch }))}
      onUploadFile={() => setPhoto("data:image/png;base64,aaa")}
      onRemove={() => setPhoto("")}
      onReset={() => setCrop({ x: 50, y: 50, zoom: 1, fit: "fill" })}
    />
  );
}

describe("FoodBiblePhotoEditor", () => {
  test("empty frame is the add-photo target and supports fit/fill/remove", () => {
    render(<Harness />);
    expect(screen.getByTestId("food-bible-card-photo-empty")).toHaveTextContent("Add photo");
    fireEvent.click(screen.getByTestId("food-bible-card-photo-empty"));
    expect(screen.getByTestId("food-bible-image-upload")).toBeInTheDocument();
  });

  test("fit and fill stay on the photo controls without x/y sliders", () => {
    render(<Harness initialPhoto="https://example.com/steak.png" />);
    expect(screen.getByTestId("food-bible-card-photo")).toBeInTheDocument();
    expect(screen.queryByTestId("food-bible-image-x")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("food-bible-image-fit"));
    expect(screen.getByTestId("food-bible-card-photo")).toHaveStyle({ objectFit: "contain" });
    fireEvent.click(screen.getByTestId("food-bible-image-fill"));
    expect(screen.getByTestId("food-bible-card-photo")).toHaveStyle({ objectFit: "cover" });
    fireEvent.click(screen.getByTestId("food-bible-image-remove"));
    expect(screen.getByTestId("food-bible-card-photo-empty")).toBeInTheDocument();
  });
});
