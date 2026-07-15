import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Plus, Search, X } from "lucide-react";
import {
  filterCatalogueSearch,
  isCatalogueItemInDestination,
  partitionCatalogueForDestination,
} from "../lib/menuSectionPlacement";

export default function MenuAddItemModal({
  open,
  destination,
  catalogue = [],
  loading = false,
  saving = false,
  onClose,
  onChooseCreateNew,
  onConfirmExisting,
  onOpenExisting,
}) {
  const [mode, setMode] = useState("choice");
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());

  const filteredCatalogue = useMemo(
    () => filterCatalogueSearch(catalogue, search),
    [catalogue, search],
  );

  const { available, alreadyPlaced } = useMemo(
    () => partitionCatalogueForDestination(filteredCatalogue, destination?.sectionId),
    [filteredCatalogue, destination?.sectionId],
  );

  const selectedCount = selectedKeys.size;

  if (!open || !destination) return null;

  const resetAndClose = () => {
    setMode("choice");
    setSearch("");
    setSelectedKeys(new Set());
    onClose();
  };

  const toggleSelection = (entry) => {
    if (isCatalogueItemInDestination(entry, destination.sectionId)) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(entry.dedupeKey)) next.delete(entry.dedupeKey);
      else next.add(entry.dedupeKey);
      return next;
    });
  };

  const handleConfirmExisting = () => {
    const selected = catalogue.filter((entry) => selectedKeys.has(entry.dedupeKey));
    onConfirmExisting(selected);
  };

  return (
    <motion.div
      className="mm-confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={resetAndClose}
      data-testid="menu-add-item-modal"
    >
      <motion.div
        className={`mm-confirm-dialog mm-add-item-dialog${mode === "existing" ? " mm-add-item-dialog-wide" : ""}`}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="mm-add-item-close"
          aria-label="Close"
          onClick={resetAndClose}
        >
          <X size={16} />
        </button>

        <p className="mm-add-item-destination">
          Adding to <strong>{destination.categoryName}</strong> →{" "}
          <strong>{destination.sectionName}</strong>
        </p>

        {mode === "choice" && (
          <>
            <h4>Add item</h4>
            <p className="mm-add-item-lead">
              Choose whether to place an existing menu item here or create a new one.
            </p>
            <div className="mm-add-item-choice-grid">
              <button
                type="button"
                className="mm-add-item-choice"
                data-testid="add-existing-item-choice"
                onClick={() => {
                  setMode("existing");
                  onOpenExisting?.();
                }}
              >
                <Plus size={18} />
                <span>Add existing menu item</span>
                <small>Search the full menu and add one or more items here.</small>
              </button>
              <button
                type="button"
                className="mm-add-item-choice"
                data-testid="create-new-item-choice"
                onClick={() => {
                  resetAndClose();
                  onChooseCreateNew();
                }}
              >
                <Plus size={18} />
                <span>Create new item</span>
                <small>Start a new item with this section as its primary placement.</small>
              </button>
            </div>
          </>
        )}

        {mode === "existing" && (
          <>
            <h4>Add existing menu item</h4>
            <div className="mm-add-item-search">
              <Search size={16} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, location, or price"
                data-testid="add-existing-item-search"
              />
            </div>

            {loading ? (
              <div className="mm-add-item-loading">
                <Loader2 size={18} className="mm-spin-icon" />
                Loading menu catalogue…
              </div>
            ) : (
              <div className="mm-add-item-catalogue" data-testid="add-existing-item-catalogue">
                {available.map((entry) => {
                  const selected = selectedKeys.has(entry.dedupeKey);
                  return (
                    <button
                      key={entry.dedupeKey}
                      type="button"
                      className={`mm-add-item-catalogue-row${selected ? " selected" : ""}`}
                      data-testid={`catalogue-row-${entry.dedupeKey}`}
                      onClick={() => toggleSelection(entry)}
                    >
                      <span className={`mm-add-item-check${selected ? " checked" : ""}`}>
                        {selected ? <Check size={14} /> : null}
                      </span>
                      <span className="mm-add-item-thumb">
                        {entry.image ? (
                          <img src={entry.image} alt="" />
                        ) : (
                          <span className="mm-add-item-thumb-fallback">No image</span>
                        )}
                      </span>
                      <span className="mm-add-item-copy">
                        <strong>{entry.name_en}</strong>
                        <span>{entry.primaryLocationLabel}</span>
                        <span>{entry.price || "—"}</span>
                      </span>
                      <span className="mm-add-item-status">
                        {!entry.active && <span className="mm-badge mm-badge-visibility">Inactive</span>}
                        {entry.sold_out && <span className="mm-badge mm-badge-sold-out">Sold Out</span>}
                      </span>
                    </button>
                  );
                })}

                {alreadyPlaced.map((entry) => (
                  <div
                    key={`placed-${entry.dedupeKey}`}
                    className="mm-add-item-catalogue-row disabled"
                    data-testid={`catalogue-row-placed-${entry.dedupeKey}`}
                    aria-disabled="true"
                  >
                    <span className="mm-add-item-check disabled" />
                    <span className="mm-add-item-thumb">
                      {entry.image ? (
                        <img src={entry.image} alt="" />
                      ) : (
                        <span className="mm-add-item-thumb-fallback">No image</span>
                      )}
                    </span>
                    <span className="mm-add-item-copy">
                      <strong>{entry.name_en}</strong>
                      <span>{entry.primaryLocationLabel}</span>
                      <span>{entry.price || "—"}</span>
                    </span>
                    <span className="mm-add-item-status">
                      <span className="mm-badge mm-badge-linked">Already here</span>
                    </span>
                  </div>
                ))}

                {!loading && available.length === 0 && alreadyPlaced.length === 0 && (
                  <p className="mm-add-item-empty">No menu items match your search.</p>
                )}
              </div>
            )}

            <div className="mm-confirm-actions">
              <button
                type="button"
                className="mm-btn mm-btn-secondary"
                onClick={() => {
                  setMode("choice");
                  setSearch("");
                  setSelectedKeys(new Set());
                }}
                disabled={saving}
              >
                Back
              </button>
              <button
                type="button"
                className="mm-btn mm-btn-primary"
                data-testid="confirm-add-existing-items"
                disabled={saving || selectedCount === 0}
                onClick={handleConfirmExisting}
              >
                {saving ? <Loader2 size={14} className="mm-spin-icon" /> : null}
                Add {selectedCount || ""} item{selectedCount === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
