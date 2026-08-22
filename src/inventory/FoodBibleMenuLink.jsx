import React, { useEffect, useMemo, useState } from "react";

function setRangeValue(input, value) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function useFoodBiblePhotoDrag() {
  useEffect(() => {
    const card = document.querySelector('[data-testid="food-bible-card"]');
    const photo = card?.querySelector('[data-testid="food-bible-card-photo"]');
    const editor = card?.querySelector('[data-testid="food-bible-image-editor"]');
    const xInput = card?.querySelector('[data-testid="food-bible-image-x"]');
    const yInput = card?.querySelector('[data-testid="food-bible-image-y"]');
    if (!photo || !editor || !xInput || !yInput) return undefined;

    const positionLabel = xInput.closest("label");
    if (positionLabel) positionLabel.style.display = "none";

    const original = {
      cursor: photo.style.cursor,
      touchAction: photo.style.touchAction,
      userSelect: photo.style.userSelect,
      height: photo.style.height,
      minHeight: photo.style.minHeight,
    };

    photo.style.cursor = "grab";
    photo.style.touchAction = "none";
    photo.style.userSelect = "none";
    photo.style.height = window.matchMedia("(max-width: 760px)").matches ? "260px" : "420px";
    photo.style.minHeight = "0";

    let drag = null;

    const onPointerDown = (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      photo.setPointerCapture?.(event.pointerId);
      const rect = photo.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: Number(xInput.value || 50),
        startY: Number(yInput.value || 50),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      };
      photo.style.cursor = "grabbing";
    };

    const onPointerMove = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      const dx = ((event.clientX - drag.startClientX) / drag.width) * 100;
      const dy = ((event.clientY - drag.startClientY) / drag.height) * 100;
      const nextX = Math.min(100, Math.max(0, drag.startX - dx));
      const nextY = Math.min(100, Math.max(0, drag.startY - dy));
      setRangeValue(xInput, nextX.toFixed(1));
      setRangeValue(yInput, nextY.toFixed(1));
    };

    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      photo.releasePointerCapture?.(event.pointerId);
      drag = null;
      photo.style.cursor = "grab";
    };

    photo.addEventListener("pointerdown", onPointerDown);
    photo.addEventListener("pointermove", onPointerMove);
    photo.addEventListener("pointerup", endDrag);
    photo.addEventListener("pointercancel", endDrag);

    return () => {
      photo.removeEventListener("pointerdown", onPointerDown);
      photo.removeEventListener("pointermove", onPointerMove);
      photo.removeEventListener("pointerup", endDrag);
      photo.removeEventListener("pointercancel", endDrag);
      photo.style.cursor = original.cursor;
      photo.style.touchAction = original.touchAction;
      photo.style.userSelect = original.userSelect;
      photo.style.height = original.height;
      photo.style.minHeight = original.minHeight;
      if (positionLabel) positionLabel.style.display = "";
    };
  });
}

export default function FoodBibleMenuLink({
  open,
  currentRecipeName,
  currentLinkName,
  identities = [],
  onCancel,
  onConfirm,
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  useFoodBiblePhotoDrag();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (identities || []).filter((item) => {
      if (!query) return true;
      return [item.name, item.nameAr, item.categoryName, item.sectionName, item.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [identities, search]);

  if (!open) return null;
  return (
    <div className="fb-link-modal" data-testid="food-bible-menu-link" role="dialog" aria-label="Link to menu item">
      <div className="fb-link-modal__panel">
        <h2>Link to menu item</h2>
        <p>
          {currentLinkName
            ? `“${currentRecipeName}” is currently linked to “${currentLinkName}”. Confirming will change that relationship.`
            : `Choose the live menu identity for “${currentRecipeName}”.`}
        </p>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, Arabic, section"
          aria-label="Search menu identities"
          data-testid="food-bible-menu-link-search"
        />
        <ul className="fb-link-modal__list">
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={selected?.id === item.id ? "is-selected" : ""}
                onClick={() => setSelected(item)}
                data-testid={`food-bible-menu-link-option-${item.id}`}
              >
                <strong>{item.name}</strong>
                {item.nameAr ? <span>{item.nameAr}</span> : null}
                <span>{[item.categoryName, item.sectionName, item.placements].filter(Boolean).join(" · ")}</span>
                <span>{item.status}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="fb-link-modal__actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            data-testid="food-bible-menu-link-confirm"
            disabled={!selected}
            onClick={() => onConfirm(selected)}
          >
            Save link
          </button>
        </div>
      </div>
    </div>
  );
}
