import React, { useMemo, useState } from "react";

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
