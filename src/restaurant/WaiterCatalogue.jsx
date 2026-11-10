import React, { useMemo, useState } from "react";
import { buildOrderingCatalogue, filterOrderingCatalogue } from "./catalogueAdapter";

export default function WaiterCatalogue({ snapshot, branchId, onAdd }) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [dietary, setDietary] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [modifierIds, setModifierIds] = useState([]);
  const [instructions, setInstructions] = useState("");
  const catalogue = useMemo(() => buildOrderingCatalogue(snapshot, { branchId }), [snapshot, branchId]);
  const lines = useMemo(
    () => (catalogue.ok ? filterOrderingCatalogue(catalogue.lines, { query, categoryId, availableOnly, dietary }) : []),
    [catalogue, query, categoryId, availableOnly, dietary],
  );
  const categories = useMemo(() => {
    const seen = new Map();
    (catalogue.lines || []).forEach((line) => {
      if (line.categoryId && !seen.has(line.categoryId)) seen.set(line.categoryId, line.categoryName);
    });
    return [...seen.entries()];
  }, [catalogue]);
  const selected = lines.find((line) => line.itemId === selectedId) || null;

  if (!catalogue.ok) {
    return <p role="status">{catalogue.reason === "hettin_guest_hidden" ? "Hettin is hidden from guests and cannot be ordered." : "This branch is not in service."}</p>;
  }

  function toggleModifier(id) {
    setModifierIds((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  return (
    <section className="rs-menu" aria-label="Canonical menu" data-testid="waiter-catalogue">
      <label className="rs-search">
        Search
        <input aria-label="Search menu" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Dish, Arabic name, allergen" />
      </label>
      <div className="rs-filters" role="toolbar" aria-label="Menu filters">
        <button type="button" aria-pressed={categoryId === ""} onClick={() => setCategoryId("")}>All</button>
        {categories.map(([id, name]) => (
          <button key={id} type="button" aria-pressed={categoryId === id} onClick={() => setCategoryId(id)}>{name}</button>
        ))}
        <button type="button" aria-pressed={availableOnly} onClick={() => setAvailableOnly((value) => !value)}>Available</button>
        <button type="button" aria-pressed={dietary === "vegetarian"} onClick={() => setDietary((value) => (value === "vegetarian" ? "" : "vegetarian"))}>Vegetarian</button>
      </div>
      <ul className="rs-grid">
        {lines.map((line) => (
          <li key={line.itemId}>
            <button
              type="button"
              className="rs-card"
              aria-pressed={selectedId === line.itemId}
              onClick={() => {
                setSelectedId(line.itemId);
                setModifierIds([]);
                setInstructions("");
              }}
            >
              <span>{line.name}</span>
              {line.nameAr ? <small dir="rtl">{line.nameAr}</small> : null}
              <span>{line.portionLabel || `${line.price} SAR`}{line.calories != null ? ` · ${line.calories} kcal` : ""}</span>
              {line.available ? null : <strong>{line.unavailableReason === "availability_not_recorded" ? "Availability not recorded" : "Unavailable"}</strong>}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <form className="rs-detail" onSubmit={(event) => {
          event.preventDefault();
          if (!selected.available) return;
          onAdd?.({ itemId: selected.itemId, modifierIds, instructions });
        }}>
          <h2>{selected.name}</h2>
          {selected.allergens.length ? <p>Allergens: {selected.allergens.join(", ")}</p> : <p>No allergens recorded</p>}
          {selected.modifiers.length ? (
            <fieldset>
              <legend>Add-ons</legend>
              {selected.modifiers.map((modifier) => (
                <label key={modifier.id}>
                  <input
                    type="checkbox"
                    checked={modifierIds.includes(modifier.id)}
                    onChange={() => toggleModifier(modifier.id)}
                  />
                  {modifier.name} +{modifier.price} SAR
                </label>
              ))}
            </fieldset>
          ) : null}
          <label>
            Preparation note
            <textarea aria-label="Preparation note" maxLength={140} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </label>
          <button type="submit" disabled={!selected.available}>Add {selected.name}</button>
        </form>
      ) : null}
    </section>
  );
}
