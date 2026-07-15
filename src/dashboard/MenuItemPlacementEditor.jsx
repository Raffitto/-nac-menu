import React, { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import {
  collectUsedPlacementKeys,
  formatPlacementLabel,
  placementKey,
} from "../lib/menuPlacements";

const EMPTY_DRAFT = { category_id: "", section_id: "" };

function sectionsForCategory(sectionsCatalog, categoryId) {
  if (!categoryId) return [];
  return sectionsCatalog.filter((section) => section.category_id === categoryId);
}

function categoryLabel(categories, categoryId) {
  return categories.find((category) => category.id === categoryId)?.name_en || categoryId;
}

function sectionLabel(sectionsCatalog, sectionId) {
  return sectionsCatalog.find((section) => section.id === sectionId)?.name_en || sectionId;
}

function PlacementPicker({
  categories,
  sectionsCatalog,
  draft,
  onDraftChange,
  usedKeys,
  excludeKey = null,
  onConfirm,
  onCancel,
  confirmLabel = "Add placement",
  testIdPrefix = "placement-picker",
}) {
  const rowSections = sectionsForCategory(sectionsCatalog, draft.category_id);
  const draftKey = placementKey(draft.category_id, draft.section_id);
  const duplicate =
    draft.category_id &&
    draft.section_id &&
    usedKeys.has(draftKey) &&
    draftKey !== excludeKey;
  const canConfirm = Boolean(draft.category_id && draft.section_id && !duplicate);

  return (
    <div className="mm-placement-picker" data-testid={`${testIdPrefix}-panel`}>
      <div className="mm-placement-picker-fields">
        <select
          className="mm-field-select"
          value={draft.category_id}
          aria-label="Placement category"
          data-testid={`${testIdPrefix}-category`}
          onChange={(e) =>
            onDraftChange({
              category_id: e.target.value,
              section_id: "",
            })
          }
        >
          <option value="">Select category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name_en || category.id}
            </option>
          ))}
        </select>
        <select
          className="mm-field-select"
          value={draft.section_id}
          aria-label="Placement section"
          data-testid={`${testIdPrefix}-section`}
          disabled={!draft.category_id}
          onChange={(e) =>
            onDraftChange({
              ...draft,
              section_id: e.target.value,
            })
          }
        >
          <option value="">Select section</option>
          {rowSections.map((section) => {
            const key = placementKey(draft.category_id, section.id);
            const taken = usedKeys.has(key) && key !== excludeKey;
            return (
              <option key={section.id} value={section.id} disabled={taken}>
                {section.name_en}
                {taken ? " (in use)" : ""}
              </option>
            );
          })}
        </select>
      </div>
      {duplicate && (
        <p className="mm-placement-picker-error" data-testid={`${testIdPrefix}-duplicate`}>
          This category and section are already used.
        </p>
      )}
      <div className="mm-placement-picker-actions">
        <button
          type="button"
          className="mm-btn mm-btn-secondary"
          data-testid={`${testIdPrefix}-cancel`}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="mm-btn mm-btn-primary"
          data-testid={`${testIdPrefix}-confirm`}
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

export default function MenuItemPlacementEditor({
  categories,
  sectionsCatalog,
  primaryCategoryId,
  primarySectionId,
  onPrimaryChange,
  extraPlacements,
  onExtraPlacementsChange,
  onRemoveExtraPlacement,
  onMoveExtraPlacement,
  createRowKey,
}) {
  const [editingPrimary, setEditingPrimary] = useState(false);
  const [editingRowKey, setEditingRowKey] = useState(null);
  const [addingPlacement, setAddingPlacement] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const primary = useMemo(
    () => ({
      category_id: primaryCategoryId,
      section_id: primarySectionId,
    }),
    [primaryCategoryId, primarySectionId],
  );

  const primaryLabel = formatPlacementLabel(
    categoryLabel(categories, primaryCategoryId),
    sectionLabel(sectionsCatalog, primarySectionId),
  );

  const usedKeys = useMemo(
    () => collectUsedPlacementKeys(primary, extraPlacements),
    [primary, extraPlacements],
  );

  const resetDraft = useCallback(() => {
    setDraft(EMPTY_DRAFT);
  }, []);

  const closeEditors = useCallback(() => {
    setEditingPrimary(false);
    setEditingRowKey(null);
    setAddingPlacement(false);
    resetDraft();
  }, [resetDraft]);

  const startAddPlacement = useCallback(() => {
    closeEditors();
    setAddingPlacement(true);
    resetDraft();
  }, [closeEditors, resetDraft]);

  const confirmAddPlacement = useCallback(() => {
    onExtraPlacementsChange([
      ...extraPlacements,
      {
        rowKey: createRowKey(),
        category_id: draft.category_id,
        section_id: draft.section_id,
      },
    ]);
    closeEditors();
  }, [closeEditors, createRowKey, draft, extraPlacements, onExtraPlacementsChange]);

  const startEditExtra = useCallback(
    (placement) => {
      closeEditors();
      setEditingRowKey(placement.rowKey);
      setDraft({
        category_id: placement.category_id,
        section_id: placement.section_id,
      });
    },
    [closeEditors],
  );

  const confirmEditExtra = useCallback(
    (index) => {
      onExtraPlacementsChange(
        extraPlacements.map((row, rowIndex) =>
          rowIndex === index
            ? {
                ...row,
                category_id: draft.category_id,
                section_id: draft.section_id,
              }
            : row,
        ),
      );
      closeEditors();
    },
    [closeEditors, draft, extraPlacements, onExtraPlacementsChange],
  );

  const confirmPrimaryEdit = useCallback(() => {
    onPrimaryChange({
      category_id: draft.category_id,
      section_id: draft.section_id,
    });
    closeEditors();
  }, [closeEditors, draft, onPrimaryChange]);

  const startPrimaryEdit = useCallback(() => {
    closeEditors();
    setEditingPrimary(true);
    setDraft({
      category_id: primaryCategoryId,
      section_id: primarySectionId,
    });
  }, [closeEditors, primaryCategoryId, primarySectionId]);

  const primaryExcludeKey = placementKey(primaryCategoryId, primarySectionId);

  return (
    <div className="mm-placement-block" data-testid="menu-item-placement-editor">
      <div className="mm-placement-section">
        <label className="mm-field-label">Primary</label>
        {editingPrimary ? (
          <PlacementPicker
            categories={categories}
            sectionsCatalog={sectionsCatalog}
            draft={draft}
            onDraftChange={setDraft}
            usedKeys={collectUsedPlacementKeys(primary, extraPlacements, {
              extrasOnly: true,
            })}
            excludeKey={primaryExcludeKey}
            onConfirm={confirmPrimaryEdit}
            onCancel={closeEditors}
            confirmLabel="Save primary"
            testIdPrefix="primary-placement-picker"
          />
        ) : (
          <button
            type="button"
            className="mm-placement-chip mm-placement-chip-primary"
            data-testid="primary-placement-chip"
            onClick={startPrimaryEdit}
          >
            <Check size={14} aria-hidden />
            <span>{primaryLabel}</span>
          </button>
        )}
      </div>

      <div className="mm-placement-section">
        <label className="mm-field-label">Additional</label>
        {extraPlacements.length === 0 && !addingPlacement && (
          <p className="mm-placement-empty">No additional placements yet.</p>
        )}
        <div className="mm-placement-chip-list" data-testid="additional-placement-list">
          {extraPlacements.map((placement, index) => {
            const chipLabel = formatPlacementLabel(
              categoryLabel(categories, placement.category_id),
              sectionLabel(sectionsCatalog, placement.section_id),
            );
            const isEditing = editingRowKey === placement.rowKey;

            if (isEditing) {
              return (
                <div
                  key={placement.rowKey}
                  className="mm-placement-chip-editor"
                  data-testid={`placement-editor-${placement.rowKey}`}
                >
                  <PlacementPicker
                    categories={categories}
                    sectionsCatalog={sectionsCatalog}
                    draft={draft}
                    onDraftChange={setDraft}
                    usedKeys={usedKeys}
                    excludeKey={placementKey(placement.category_id, placement.section_id)}
                    onConfirm={() => confirmEditExtra(index)}
                    onCancel={closeEditors}
                    confirmLabel="Save placement"
                    testIdPrefix={`edit-placement-picker-${placement.rowKey}`}
                  />
                </div>
              );
            }

            return (
              <div
                key={placement.rowKey}
                className="mm-placement-chip-row"
                data-testid={`placement-chip-row-${placement.rowKey}`}
              >
                <button
                  type="button"
                  className="mm-placement-chip"
                  data-testid={`placement-chip-${placement.rowKey}`}
                  onClick={() => startEditExtra(placement)}
                >
                  <span>{chipLabel}</span>
                </button>
                <div className="mm-placement-chip-controls">
                  <button
                    type="button"
                    className="mm-placement-chip-control"
                    aria-label="Move placement up"
                    data-testid={`placement-move-up-${placement.rowKey}`}
                    disabled={index === 0}
                    onClick={() => onMoveExtraPlacement(index, index - 1)}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="mm-placement-chip-control"
                    aria-label="Move placement down"
                    data-testid={`placement-move-down-${placement.rowKey}`}
                    disabled={index === extraPlacements.length - 1}
                    onClick={() => onMoveExtraPlacement(index, index + 1)}
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="mm-placement-chip-remove"
                    aria-label="Remove placement"
                    data-testid={`placement-remove-${placement.rowKey}`}
                    onClick={() => onRemoveExtraPlacement(index)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {addingPlacement ? (
          <div className="mm-placement-chip-editor" data-testid="add-placement-picker">
            <PlacementPicker
              categories={categories}
              sectionsCatalog={sectionsCatalog}
              draft={draft}
              onDraftChange={setDraft}
              usedKeys={usedKeys}
              onConfirm={confirmAddPlacement}
              onCancel={closeEditors}
              confirmLabel="Add placement"
              testIdPrefix="add-placement-picker"
            />
          </div>
        ) : (
          <button
            type="button"
            className="mm-btn mm-btn-secondary mm-placement-add"
            data-testid="add-placement-button"
            onClick={startAddPlacement}
          >
            <Plus size={14} />
            Add placement
          </button>
        )}
      </div>
    </div>
  );
}
