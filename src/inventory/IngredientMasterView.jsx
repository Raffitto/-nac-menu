import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  createIngredient,
  fetchIngredientDependencySummary,
  fetchIngredients,
  fetchInventoryStaffAccess,
  findDuplicateIngredient,
  setIngredientActive,
  updateIngredient,
} from "../lib/inventoryApi";
import {
  CANONICAL_UNITS,
  EMPTY_INGREDIENT_FORM,
  canManageBranchIngredients,
  canManageNetworkIngredients,
  collectCategoryOptions,
  duplicateNameMessage,
  filterIngredients,
  formatIngredientTimestamp,
  friendlyIngredientError,
  unitLabel,
  validateIngredientForm,
} from "./ingredientMaster";
import { classificationDefault, INVENTORY_CLASSIFICATIONS } from "./inventoryControls";

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "inactive", label: "Inactive" },
];

function formFromIngredient(ingredient) {
  if (!ingredient) return { ...EMPTY_INGREDIENT_FORM };
  return {
    canonicalName: ingredient.canonicalName || "",
    category: ingredient.category || "",
    baseInventoryUnit: ingredient.baseInventoryUnit || "each",
    inventoryClassification: ingredient.inventoryClassification || "food_ingredient",
    recipeCostEligible: ingredient.recipeCostEligible !== false,
    notes: ingredient.description || "",
    scope: ingredient.scope || "branch",
    active: ingredient.active !== false,
    originalBaseUnit: ingredient.baseInventoryUnit || "each",
  };
}

export default function IngredientMasterView({ branchId }) {
  const [ingredients, setIngredients] = useState([]);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [panelMode, setPanelMode] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_INGREDIENT_FORM });
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [unitLocked, setUnitLocked] = useState(false);

  const canEditBranch = canManageBranchIngredients(access, branchId);
  const canEditNetwork = canManageNetworkIngredients(access);
  const canEdit = canEditBranch || canEditNetwork;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rows, staffAccess] = await Promise.all([
        fetchIngredients({ branchId, includeInactive: true }),
        fetchInventoryStaffAccess(),
      ]);
      setIngredients(rows);
      setAccess(staffAccess);
    } catch (err) {
      setError(friendlyIngredientError(err, "Could not load ingredients."));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const categories = useMemo(() => collectCategoryOptions(ingredients), [ingredients]);
  const filtered = useMemo(
    () => filterIngredients(ingredients, {
      search,
      category: categoryFilter,
      status: statusFilter,
    }),
    [ingredients, search, categoryFilter, statusFilter],
  );

  const selected = useMemo(
    () => ingredients.find((ingredient) => ingredient.id === selectedId) || null,
    [ingredients, selectedId],
  );

  const openCreate = () => {
    setPanelMode("create");
    setSelectedId(null);
    setDuplicateWarning("");
    setUnitLocked(false);
    setForm({
      ...EMPTY_INGREDIENT_FORM,
      scope: canEditNetwork ? "branch" : "branch",
    });
  };

  const openEdit = async (ingredient) => {
    setPanelMode("edit");
    setSelectedId(ingredient.id);
    setDuplicateWarning("");
    setForm(formFromIngredient(ingredient));
    setUnitLocked(false);
    try {
      const summary = await fetchIngredientDependencySummary(ingredient.id);
      setUnitLocked(summary.hasDependencies);
    } catch {
      setUnitLocked(true);
    }
  };

  const closePanel = () => {
    if (busy) return;
    setPanelMode(null);
    setSelectedId(null);
    setDuplicateWarning("");
    setUnitLocked(false);
    setForm({ ...EMPTY_INGREDIENT_FORM });
  };

  const checkDuplicate = async (canonicalName, scope) => {
    const duplicate = await findDuplicateIngredient({
      canonicalName,
      branchId: scope === "network" ? null : branchId,
      scope,
      excludeId: panelMode === "edit" ? selectedId : null,
    });
    if (duplicate) {
      setDuplicateWarning(duplicateNameMessage(duplicate.canonical_name));
      return true;
    }
    setDuplicateWarning("");
    return false;
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!canEdit || busy) return;

    const validation = validateIngredientForm(form, { allowUnitChange: !unitLocked });
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    const scope = form.scope === "network" ? "network" : "branch";
    if (scope === "network" && !canEditNetwork) {
      setError("You can only create branch ingredients for this account.");
      return;
    }
    if (scope === "branch" && !canEditBranch) {
      setError("You don't have permission to edit branch ingredients.");
      return;
    }

    setBusy("save");
    setError("");
    setNotice("");
    try {
      const hasDuplicate = await checkDuplicate(validation.canonicalName, scope);
      if (hasDuplicate) {
        setError(duplicateWarning || duplicateNameMessage());
        return;
      }

      if (panelMode === "create") {
        await createIngredient({
          canonicalName: validation.canonicalName,
          category: form.category.trim(),
          baseInventoryUnit: form.baseInventoryUnit,
          inventoryClassification: form.inventoryClassification,
          recipeCostEligible: form.recipeCostEligible,
          description: form.notes.trim() || null,
          branchId: scope === "network" ? null : branchId,
          active: true,
        });
        setNotice("Ingredient created.");
      } else if (selectedId) {
        await updateIngredient(selectedId, {
          canonicalName: validation.canonicalName,
          category: form.category.trim(),
          baseInventoryUnit: unitLocked ? form.originalBaseUnit : form.baseInventoryUnit,
          inventoryClassification: form.inventoryClassification,
          recipeCostEligible: form.recipeCostEligible,
          description: form.notes.trim() || null,
        });
        setNotice("Ingredient updated.");
      }
      closePanel();
      await refresh();
    } catch (err) {
      setError(friendlyIngredientError(err, "Could not save ingredient."));
    } finally {
      setBusy("");
    }
  };

  const handleDeactivate = async () => {
    if (!selected || !canEdit || busy) return;
    const confirmed = window.confirm(
      `Deactivate "${selected.canonicalName}"?\n\nIt will stay in historical records but won't appear for new invoice matching.`,
    );
    if (!confirmed) return;
    setBusy("deactivate");
    setError("");
    setNotice("");
    try {
      await setIngredientActive(selected.id, false);
      setNotice("Ingredient deactivated.");
      closePanel();
      setStatusFilter("inactive");
      await refresh();
    } catch (err) {
      setError(friendlyIngredientError(err, "Could not deactivate ingredient."));
    } finally {
      setBusy("");
    }
  };

  const handleReactivate = async () => {
    if (!selected || !canEdit || busy) return;
    setBusy("reactivate");
    setError("");
    setNotice("");
    try {
      await setIngredientActive(selected.id, true);
      setNotice("Ingredient reactivated.");
      closePanel();
      setStatusFilter("active");
      await refresh();
    } catch (err) {
      setError(friendlyIngredientError(err, "Could not reactivate ingredient."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="inv-ingredients" data-testid="ingredient-master-view">
      {(error || notice) && (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="inv-ingredients-toolbar">
        <div className="inv-ingredients-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ingredients"
            aria-label="Search ingredients"
            data-testid="ingredient-search-input"
          />
        </div>
        <label className="inv-ingredients-filter">
          <span>Category</span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filter by category"
            data-testid="ingredient-category-filter"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="inv-ingredients-filter">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by status"
            data-testid="ingredient-status-filter"
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>{filter.label}</option>
            ))}
          </select>
        </label>
        {canEdit ? (
          <button
            type="button"
            className="inv-button inv-button--primary"
            onClick={openCreate}
            data-testid="add-ingredient-button"
          >
            <Plus size={16} /> Add ingredient
          </button>
        ) : null}
      </div>

      <p className="inv-ingredients-count" data-testid="ingredient-result-count">
        {loading ? "Loading ingredients…" : `${filtered.length} ingredient${filtered.length === 1 ? "" : "s"}`}
        {!loading && !canEdit ? " · Read-only access" : ""}
      </p>

      {loading ? (
        <div className="inv-ingredients-state" data-testid="ingredient-loading-state">
          <Loader2 size={22} className="inv-spin" aria-hidden="true" />
          Loading ingredients…
        </div>
      ) : filtered.length === 0 ? (
        <div className="inv-ingredients-state" data-testid="ingredient-empty-state">
          <p>{search || categoryFilter !== "all" || statusFilter !== "all"
            ? "No ingredients match your search or filters."
            : "No ingredients yet. Add the first canonical ingredient for this branch."}
          </p>
          {canEdit && !search && categoryFilter === "all" && statusFilter === "active" ? (
            <button type="button" className="inv-button inv-button--secondary" onClick={openCreate}>
              <Plus size={16} /> Add ingredient
            </button>
          ) : null}
        </div>
      ) : (
        <div className="inv-ingredients-table-wrap">
          <table className="inv-ingredients-table">
            <thead>
              <tr>
                <th scope="col">Ingredient</th>
                <th scope="col">Category</th>
                <th scope="col">Classification</th>
                <th scope="col">Base unit</th>
                <th scope="col">Scope</th>
                <th scope="col">Status</th>
                <th scope="col">Last updated</th>
                {canEdit ? <th scope="col"><span className="inv-sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ingredient) => (
                <tr key={ingredient.id} data-testid={`ingredient-row-${ingredient.id}`}>
                  <td>
                    <strong>{ingredient.canonicalName}</strong>
                    {ingredient.description ? (
                      <div className="inv-ingredients-note">{ingredient.description}</div>
                    ) : null}
                  </td>
                  <td>{ingredient.category || "—"}</td>
                  <td>{INVENTORY_CLASSIFICATIONS.find(({ value }) => value === ingredient.inventoryClassification)?.label || "Other"}</td>
                  <td>{unitLabel(ingredient.baseInventoryUnit)}</td>
                  <td>{ingredient.scope === "network" ? "Network" : "Branch"}</td>
                  <td>
                    <span className={`inv-status-pill inv-status-pill--${ingredient.active ? "active" : "inactive"}`}>
                      {ingredient.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>{formatIngredientTimestamp(ingredient.updatedAt)}</td>
                  {canEdit ? (
                    <td>
                      <button
                        type="button"
                        className="inv-button inv-button--ghost inv-ingredients-edit"
                        aria-label={`Edit ${ingredient.canonicalName}`}
                        onClick={() => openEdit(ingredient)}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {panelMode ? (
        <div className="inv-ingredients-panel-backdrop" onClick={closePanel} role="presentation">
          <aside
            className="inv-ingredients-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={panelMode === "create" ? "Add ingredient" : "Edit ingredient"}
            data-testid="ingredient-editor-panel"
          >
            <header className="inv-ingredients-panel-header">
              <div>
                <p className="inv-kicker">Ingredient master</p>
                <h2>{panelMode === "create" ? "Add ingredient" : "Edit ingredient"}</h2>
              </div>
              <button type="button" className="inv-button inv-button--ghost" onClick={closePanel} aria-label="Close editor">
                <X size={16} />
              </button>
            </header>

            <form className="inv-ingredients-form" onSubmit={handleSave}>
              <label>
                <span>Ingredient name</span>
                <input
                  value={form.canonicalName}
                  onChange={(event) => setForm((prev) => ({ ...prev, canonicalName: event.target.value }))}
                  placeholder="e.g. Heavy cream"
                  required
                  data-testid="ingredient-name-input"
                />
              </label>

              {duplicateWarning ? (
                <p className="inv-ingredients-warning" data-testid="ingredient-duplicate-warning">{duplicateWarning}</p>
              ) : null}

              <label>
                <span>Category</span>
                <input
                  list="ingredient-category-options"
                  value={form.category}
                  onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                  placeholder="e.g. Dairy"
                  required
                  data-testid="ingredient-category-input"
                />
                <datalist id="ingredient-category-options">
                  {categories.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </label>

              <label>
                <span>Base unit</span>
                <select
                  value={form.baseInventoryUnit}
                  onChange={(event) => setForm((prev) => ({ ...prev, baseInventoryUnit: event.target.value }))}
                  disabled={unitLocked}
                  required
                  data-testid="ingredient-unit-select"
                >
                  {CANONICAL_UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>{unit.label}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Inventory classification</span>
                <select
                  value={form.inventoryClassification}
                  onChange={(event) => {
                    const inventoryClassification = event.target.value;
                    setForm((prev) => ({
                      ...prev,
                      inventoryClassification,
                      recipeCostEligible: classificationDefault(inventoryClassification),
                    }));
                  }}
                  required
                  data-testid="ingredient-classification-select"
                >
                  {INVENTORY_CLASSIFICATIONS.map((classification) => (
                    <option key={classification.value} value={classification.value}>{classification.label}</option>
                  ))}
                </select>
              </label>

              <label className="inv-ingredients-checkbox">
                <input
                  type="checkbox"
                  checked={form.recipeCostEligible}
                  onChange={(event) => setForm((prev) => ({ ...prev, recipeCostEligible: event.target.checked }))}
                  data-testid="ingredient-recipe-eligible-checkbox"
                />
                <span>Eligible for recipe costing</span>
              </label>

              {unitLocked ? (
                <p className="inv-ingredients-help" data-testid="ingredient-unit-lock-note">
                  Base unit is locked because this ingredient already has purchase, catalogue, or stock history.
                </p>
              ) : null}

              {panelMode === "create" && canEditNetwork ? (
                <label>
                  <span>Availability</span>
                  <select
                    value={form.scope}
                    onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value }))}
                    data-testid="ingredient-scope-select"
                  >
                    <option value="branch">This branch only</option>
                    <option value="network">Network-wide</option>
                  </select>
                </label>
              ) : null}

              <label>
                <span>Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Optional notes for purchasing or kitchen teams"
                  rows={3}
                  data-testid="ingredient-notes-input"
                />
              </label>

              <div className="inv-ingredients-form-actions">
                {panelMode === "edit" && selected?.active ? (
                  <button
                    type="button"
                    className="inv-button inv-button--danger"
                    onClick={handleDeactivate}
                    disabled={Boolean(busy)}
                    data-testid="deactivate-ingredient-button"
                  >
                    Deactivate
                  </button>
                ) : null}
                {panelMode === "edit" && selected && !selected.active ? (
                  <button
                    type="button"
                    className="inv-button inv-button--secondary"
                    onClick={handleReactivate}
                    disabled={Boolean(busy)}
                    data-testid="reactivate-ingredient-button"
                  >
                    Reactivate
                  </button>
                ) : null}
                <div className="inv-ingredients-form-actions-right">
                  <button type="button" className="inv-button inv-button--ghost" onClick={closePanel} disabled={Boolean(busy)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inv-button inv-button--primary"
                    disabled={Boolean(busy) || Boolean(duplicateWarning)}
                    data-testid="save-ingredient-button"
                  >
                    {busy === "save" ? <Loader2 size={16} className="inv-spin" /> : null}
                    Save ingredient
                  </button>
                </div>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
