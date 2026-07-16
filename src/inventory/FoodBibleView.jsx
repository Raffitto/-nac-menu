import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  fetchFoodBibleOverview,
  fetchInventoryStaffAccess,
} from "../lib/inventoryApi";
import {
  READINESS,
  READINESS_LABELS,
  canManageBranchRecipes,
  canManageNetworkRecipes,
  filterFoodBibleRows,
  formatRecipeTimestamp,
  friendlyRecipeError,
  guestMenuStatusLabel,
  recipeTypeLabel,
} from "./foodBible";
import RecipeEditorPanel from "./RecipeEditorPanel";

const READINESS_FILTERS = [
  { id: "all", label: "All" },
  { id: READINESS.MISSING, label: "Missing recipe" },
  { id: READINESS.DRAFT, label: "In progress" },
  { id: READINESS.READY, label: "Complete" },
  { id: READINESS.NEEDS_ATTENTION, label: "Needs attention" },
];

const MENU_FILTERS = [
  { id: "all", label: "All menu items" },
  { id: "active", label: "Live on menu" },
  { id: "hidden", label: "Hidden" },
  { id: "sold_out", label: "Sold out" },
];

export default function FoodBibleView({ branchId, onOpenIngredients }) {
  const [overview, setOverview] = useState(null);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [menuFilter, setMenuFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editorTarget, setEditorTarget] = useState(null);

  const canEditBranch = canManageBranchRecipes(access, branchId);
  const canEditNetwork = canManageNetworkRecipes(access);
  const canEdit = canEditBranch || canEditNetwork;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, staffAccess] = await Promise.all([
        fetchFoodBibleOverview({ branchId }),
        fetchInventoryStaffAccess(),
      ]);
      setOverview(data);
      setAccess(staffAccess);
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not load Food Bible."));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const categories = useMemo(() => {
    const values = new Set();
    for (const row of overview?.rows || []) {
      if (row.categoryName) values.add(row.categoryName);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [overview?.rows]);

  const filtered = useMemo(
    () => filterFoodBibleRows(overview?.rows || [], {
      search,
      readiness: readinessFilter,
      menuVisibility: menuFilter,
      category: categoryFilter,
    }),
    [overview?.rows, search, readinessFilter, menuFilter, categoryFilter],
  );

  const summary = overview?.summary || {
    totalMenuItems: 0,
    complete: 0,
    inProgress: 0,
    missing: 0,
    needsAttention: 0,
    coveragePct: 0,
  };

  const openEditor = (row) => {
    setEditorTarget(row);
  };

  const closeEditor = () => {
    setEditorTarget(null);
  };

  const handleSaved = async () => {
    setNotice("Recipe saved.");
    closeEditor();
    await refresh();
  };


  return (
    <section className="inv-food-bible" data-testid="food-bible-view">
      {(error || notice) && (
        <div className={`inv-banner ${error ? "inv-banner--error" : "inv-banner--success"}`}>
          {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => { setError(""); setNotice(""); }}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="inv-fb-summary">
        <article data-testid="food-bible-metric-total">
          <strong>{summary.totalMenuItems}</strong>
          <span>Total menu items</span>
        </article>
        <article data-testid="food-bible-metric-complete">
          <strong>{summary.complete}</strong>
          <span>Recipe complete</span>
        </article>
        <article data-testid="food-bible-metric-progress">
          <strong>{summary.inProgress}</strong>
          <span>In progress</span>
        </article>
        <article data-testid="food-bible-metric-missing">
          <strong>{summary.missing}</strong>
          <span>Missing recipe</span>
        </article>
        <article data-testid="food-bible-metric-coverage">
          <strong>{summary.coveragePct}%</strong>
          <span>Coverage</span>
        </article>
      </div>

      <div className="inv-ingredients-toolbar">
        <div className="inv-ingredients-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search menu items and recipes"
            aria-label="Search Food Bible"
            data-testid="food-bible-search-input"
          />
        </div>
        <label className="inv-ingredients-filter">
          <span>Recipe status</span>
          <select
            value={readinessFilter}
            onChange={(event) => setReadinessFilter(event.target.value)}
            data-testid="food-bible-readiness-filter"
          >
            {READINESS_FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>{filter.label}</option>
            ))}
          </select>
        </label>
        <label className="inv-ingredients-filter">
          <span>Menu status</span>
          <select
            value={menuFilter}
            onChange={(event) => setMenuFilter(event.target.value)}
            data-testid="food-bible-menu-filter"
          >
            {MENU_FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>{filter.label}</option>
            ))}
          </select>
        </label>
        <label className="inv-ingredients-filter">
          <span>Category</span>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            data-testid="food-bible-category-filter"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        {canEdit ? (
          <button
            type="button"
            className="inv-button inv-button--primary"
            onClick={() => openEditor({ kind: "new_component" })}
            data-testid="create-component-recipe-button"
          >
            <Plus size={16} /> New component
          </button>
        ) : null}
      </div>

      <p className="inv-ingredients-count" data-testid="food-bible-result-count">
        {loading ? "Loading Food Bible…" : `${filtered.length} item${filtered.length === 1 ? "" : "s"}`}
        {!loading && !canEdit ? " · Read-only access" : ""}
      </p>

      {loading ? (
        <div className="inv-ingredients-state" data-testid="food-bible-loading-state">
          <Loader2 size={22} className="inv-spin" aria-hidden="true" />
          Loading Food Bible…
        </div>
      ) : !loading && filtered.length === 0 && (overview?.rows || []).length === 0 ? (
        <div className="inv-ingredients-state" data-testid="food-bible-empty-state">
          <BookOpen size={28} aria-hidden="true" />
          <p>No recipes have been documented yet.</p>
          {!overview?.hasActiveIngredients ? (
            <p>Add ingredients in Ingredient Master before documenting recipes.</p>
          ) : null}
          {canEdit ? (
            <div className="inv-fb-empty-actions">
              {!overview?.hasActiveIngredients && onOpenIngredients ? (
                <button type="button" className="inv-button inv-button--secondary" onClick={onOpenIngredients}>
                  Open Ingredient Master
                </button>
              ) : null}
              <button
                type="button"
                className="inv-button inv-button--primary"
                onClick={() => openEditor(filtered[0] || { kind: "menu_item", readiness: READINESS.MISSING })}
                data-testid="start-documenting-recipes-button"
              >
                Start documenting recipes
              </button>
            </div>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <div className="inv-ingredients-state" data-testid="food-bible-filter-empty-state">
          <p>No items match your search or filters.</p>
        </div>
      ) : (
        <div className="inv-ingredients-table-wrap">
          <table className="inv-ingredients-table inv-fb-table">
            <thead>
              <tr>
                <th scope="col">Menu item / recipe</th>
                <th scope="col">Category</th>
                <th scope="col">Recipe status</th>
                <th scope="col">Type</th>
                <th scope="col">Menu status</th>
                <th scope="col">Yield</th>
                <th scope="col">Lines</th>
                <th scope="col">Last updated</th>
                {canEdit ? <th scope="col"><span className="inv-sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.identityKey} data-testid={`food-bible-row-${row.identityKey}`}>
                  <td>
                    <strong>{row.displayName}</strong>
                    {row.displayNameAr ? <div className="inv-ingredients-note">{row.displayNameAr}</div> : null}
                    {row.placements?.length > 1 ? (
                      <div className="inv-ingredients-note">
                        Appears in {row.placements.length} menu placements
                      </div>
                    ) : null}
                  </td>
                  <td>{row.categoryName}</td>
                  <td>
                    <span className={`inv-status-pill inv-status-pill--${row.readiness}`}>
                      {READINESS_LABELS[row.readiness]}
                    </span>
                  </td>
                  <td>{recipeTypeLabel(row.recipeType)}</td>
                  <td>{row.guestStatus ? guestMenuStatusLabel(row.guestStatus) : "—"}</td>
                  <td>{row.yieldSummary}</td>
                  <td>{row.lineCount}</td>
                  <td>{formatRecipeTimestamp(row.updatedAt)}</td>
                  {canEdit ? (
                    <td>
                      <button
                        type="button"
                        className="inv-button inv-button--ghost inv-ingredients-edit"
                        onClick={() => openEditor(row)}
                        data-testid={`open-recipe-editor-${row.identityKey}`}
                      >
                        {row.recipeId ? "Edit" : "Document"}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorTarget ? (
        <RecipeEditorPanel
          branchId={branchId}
          target={editorTarget}
          overview={overview}
          canEditNetwork={canEditNetwork}
          canEditBranch={canEditBranch}
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      ) : null}
    </section>
  );
}
