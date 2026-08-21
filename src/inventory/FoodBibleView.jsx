import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  fetchFoodBibleOverview,
  fetchInventoryStaffAccess,
  fetchCanonicalCostContext,
  fetchRecipeBundle,
} from "../lib/inventoryApi";
import {
  flattenSelectedRecipeTrees,
  recipePdfFilename,
  recipesPdfBytes,
  fetchHeroImageDataUrl,
  snapshotFromRecipeRecord,
  triggerPdfDownload,
} from "./recipePdfExport";
import {
  CATALOGUE_SCOPES,
  READINESS,
  READINESS_LABELS,
  canManageBranchRecipes,
  canManageNetworkRecipes,
  filterFoodBibleRows,
  foodBibleCostCell,
  formatRecipeTimestamp,
  friendlyRecipeError,
  guestMenuStatusLabel,
  recipeTypeLabel,
} from "./foodBible";
import FoodBibleCard from "./FoodBibleCard";
import { formatSar } from "./costTrust";
import { popCardTarget } from "./foodBibleCardNav";

const READINESS_FILTERS = [
  { id: "all", label: "All" },
  { id: READINESS.MISSING, label: "Missing recipe" },
  { id: READINESS.DRAFT, label: "In progress" },
  { id: READINESS.READY, label: "Complete" },
  { id: READINESS.NEEDS_ATTENTION, label: "Needs attention" },
];

const CATALOGUE_FILTERS = [
  { id: CATALOGUE_SCOPES.KITCHEN, label: "Live kitchen" },
  { id: CATALOGUE_SCOPES.COMPONENTS, label: "Prepared components" },
  { id: CATALOGUE_SCOPES.DRINKS, label: "Drinks / packaged" },
  { id: CATALOGUE_SCOPES.ARCHIVED, label: "Archived" },
  { id: CATALOGUE_SCOPES.REVIEW, label: "Needs review / menu link" },
  { id: CATALOGUE_SCOPES.ALL, label: "All identities" },
];

export default function FoodBibleView({
  branchId,
  onOpenIngredients,
  initialTarget = null,
  onInitialTargetHandled,
}) {
  const [overview, setOverview] = useState(null);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [readinessFilter, setReadinessFilter] = useState("all");
  const [catalogueFilter, setCatalogueFilter] = useState(CATALOGUE_SCOPES.KITCHEN);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editorStack, setEditorStack] = useState([]);
  const bundleCacheRef = useRef(new Map());
  const [costAsOf, setCostAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [downloadBusy, setDownloadBusy] = useState("");
  const [visibleCount, setVisibleCount] = useState(80);
  const [narrow, setNarrow] = useState(false);

  const canEditBranch = canManageBranchRecipes(access, branchId);
  const canEditNetwork = canManageNetworkRecipes(access);
  const canEdit = canEditBranch || canEditNetwork;

  const refresh = useCallback(async ({ force = true } = {}) => {
    setError("");
    try {
      const [data, staffAccess] = await Promise.all([
        fetchFoodBibleOverview({ branchId, asOf: costAsOf, forceRefresh: force }),
        fetchInventoryStaffAccess(),
      ]);
      setOverview({ ...data, costByCanonicalId: data.costByCanonicalId || {} });
      setAccess(staffAccess);
      fetchCanonicalCostContext({ branchId, asOf: `${costAsOf}T23:59:59+03:00` })
        .then((costContext) => {
          setOverview((current) => current ? {
            ...current,
            costByCanonicalId: costContext.costByCanonicalId || {},
          } : current);
        })
        .catch(() => {});
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not load Food Bible."));
    } finally {
      setLoading(false);
    }
  }, [branchId, costAsOf]);

  useEffect(() => {
    refresh({ force: false });
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 760px)");
    const onChange = () => setNarrow(media.matches);
    onChange();
    if (media.addEventListener) media.addEventListener("change", onChange);
    else media.addListener(onChange);
    return () => {
      if (media.removeEventListener) media.removeEventListener("change", onChange);
      else media.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    if (!initialTarget?.menuItemId || !(overview?.rows || []).length) return;
    const row = overview.rows.find(
      (entry) => entry.menuItemId === initialTarget.menuItemId,
    );
    if (row) {
      bundleCacheRef.current = new Map();
      setEditorStack([row]);
    }
    onInitialTargetHandled?.();
  }, [initialTarget, overview?.rows, onInitialTargetHandled]);

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
      category: categoryFilter,
      catalogue: catalogueFilter,
    }),
    [overview?.rows, search, readinessFilter, categoryFilter, catalogueFilter],
  );

  useEffect(() => {
    setVisibleCount(narrow ? 30 : 80);
  }, [search, readinessFilter, categoryFilter, catalogueFilter, narrow]);

  const pageSize = narrow ? 30 : 80;
  const visibleRows = filtered.slice(0, visibleCount);

  const summary = overview?.summary || {
    totalMenuItems: 0,
    liveKitchenItems: 0,
    complete: 0,
    incomplete: 0,
    inProgress: 0,
    missing: 0,
    needsAttention: 0,
    mapped: 0,
    coveragePct: 0,
    fullyCosted: 0,
    partiallyCosted: 0,
    uncosted: 0,
    costCoveragePct: 0,
  };

  const editorTarget = editorStack[editorStack.length - 1] || null;

  const openEditor = (row) => {
    bundleCacheRef.current = new Map();
    setEditorStack([row]);
  };

  const closeEditor = () => {
    setEditorStack([]);
  };

  const goBack = () => {
    setEditorStack((stack) => popCardTarget(stack));
  };

  const openComponent = (next) => {
    if (typeof window !== "undefined" && window.history?.pushState) {
      window.history.pushState({ foodBibleCard: true }, "");
    }
    setEditorStack((stack) => [...stack, next]);
  };

  useEffect(() => {
    if (!editorStack.length) return undefined;
    const onPop = () => {
      setEditorStack((stack) => popCardTarget(stack));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [editorStack.length]);

  const handleSaved = async () => {
    setNotice("Recipe saved.");
    closeEditor();
    await refresh();
  };

  const ingredientById = useMemo(
    () => new Map((overview?.ingredients || []).map((ingredient) => [ingredient.id, ingredient])),
    [overview?.ingredients],
  );
  const recipeById = useMemo(
    () => new Map((overview?.recipes || []).map((recipe) => [recipe.id, recipe])),
    [overview?.recipes],
  );

  const loadBundle = useCallback(async (recipeId) => {
    if (!recipeId) return null;
    if (!bundleCacheRef.current.has(recipeId)) {
      bundleCacheRef.current.set(recipeId, fetchRecipeBundle(recipeId));
    }
    return bundleCacheRef.current.get(recipeId);
  }, []);

  const snapshotFromBundle = useCallback(async (rowHint, bundle) => {
    const recipe = bundle?.recipe;
    return snapshotFromRecipeRecord({
      row: {
        ...rowHint,
        displayName: rowHint?.displayName || recipe?.name,
        recipeType: recipe?.recipeType || rowHint?.recipeType,
        kind: rowHint?.kind || (recipe?.recipeType === "menu_item" ? "menu_item" : "component"),
        outputQuantity: recipe?.outputQuantity,
        outputUnit: recipe?.outputUnit,
        heroImagePath: recipe?.heroImagePath || null,
      },
      lines: bundle?.lines || [],
      documentation: bundle?.version?.documentation || {},
      version: bundle?.version,
      ingredientById,
      recipeById,
      generatedAt: new Date().toISOString(),
      imageDataUrl: await fetchHeroImageDataUrl(recipe?.heroImagePath),
    });
  }, [ingredientById, recipeById]);

  const snapshotTreeForRoots = useCallback(async (rootRows) => {
    const linesByRecipeId = {};
    const bundles = {};
    const load = async (id) => {
      if (!id || bundles[id]) return;
      const bundle = await loadBundle(id);
      bundles[id] = bundle;
      linesByRecipeId[id] = bundle?.lines || [];
      for (const line of linesByRecipeId[id]) {
        if (line.subRecipeId) await load(line.subRecipeId);
      }
    };
    for (const row of rootRows) await load(row.recipeId);
    const order = flattenSelectedRecipeTrees(rootRows.map((row) => row.recipeId), linesByRecipeId);
    const rootById = new Map(rootRows.map((row) => [row.recipeId, row]));
    return Promise.all(order.map((id) => snapshotFromBundle(rootById.get(id) || { recipeId: id, kind: "component" }, bundles[id])));
  }, [loadBundle, snapshotFromBundle]);

  const downloadSnapshots = (snapshots, filename, combined = false) => {
    if (!snapshots.length) {
      setError("Select at least one recipe with documented ingredients.");
      return;
    }
    const bytes = recipesPdfBytes(snapshots, {
      title: combined ? "NAC Food Bible" : snapshots.length > 1 ? "Selected recipes" : snapshots[0].name,
    });
    triggerPdfDownload(bytes, filename);
    setNotice(`Downloaded ${snapshots.length} recipe${snapshots.length === 1 ? "" : "s"}.`);
  };

  const handleDownloadRow = async (row) => {
    if (!row.recipeId) {
      setError("This menu item does not have a recipe yet.");
      return;
    }
    setDownloadBusy(row.identityKey);
    try {
      const snapshots = await snapshotTreeForRoots([row]);
      downloadSnapshots(snapshots, recipePdfFilename(row.displayName));
    } finally {
      setDownloadBusy("");
    }
  };

  const handleDownloadSelected = async () => {
    setDownloadBusy("selected");
    try {
      const snapshots = await snapshotTreeForRoots(
        filtered.filter((row) => selectedKeys.has(row.identityKey) && row.recipeId),
      );
      downloadSnapshots(snapshots, recipePdfFilename("selected-recipes", { combined: true }), true);
    } finally {
      setDownloadBusy("");
    }
  };

  const handleDownloadFoodBible = async () => {
    setDownloadBusy("bible");
    try {
      const snapshots = await snapshotTreeForRoots(
        (overview?.rows || []).filter((row) => row.kind === "menu_item" && row.guestStatus === "live" && row.recipeId),
      );
      downloadSnapshots(snapshots, recipePdfFilename("food-bible", { combined: true }), true);
    } finally {
      setDownloadBusy("");
    }
  };

  const selectable = filtered.filter((row) => row.recipeId);
  const allFilteredSelected = selectable.length > 0 && selectable.every((row) => selectedKeys.has(row.identityKey));

  const toggleSelect = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        selectable.forEach((row) => next.delete(row.identityKey));
        return next;
      });
      return;
    }
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      selectable.forEach((row) => next.add(row.identityKey));
      return next;
    });
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
          <strong>{summary.liveKitchenItems ?? summary.totalMenuItems}</strong>
          <span>Live kitchen items</span>
        </article>
        <article data-testid="food-bible-metric-mapped">
          <strong>{summary.mapped}</strong>
          <span>Mapped</span>
        </article>
        <article data-testid="food-bible-metric-complete">
          <strong>{summary.complete}</strong>
          <span>Recipe complete</span>
        </article>
        <article data-testid="food-bible-metric-progress">
          <strong>{summary.needsAttention ?? summary.incomplete ?? summary.inProgress}</strong>
          <span>Needs attention</span>
        </article>
        <article data-testid="food-bible-metric-missing">
          <strong>{summary.missing}</strong>
          <span>Missing recipe</span>
        </article>
        <article data-testid="food-bible-metric-review">
          <strong>{summary.needsReview || 0}</strong>
          <span>Needs review / link</span>
        </article>
        <article data-testid="food-bible-metric-coverage">
          <strong>{summary.coveragePct}%</strong>
          <span>Recipe coverage</span>
        </article>
      </div>

      <div className="inv-fb-summary" data-testid="food-bible-cost-health">
        <article data-testid="food-bible-metric-costed">
          <strong>{summary.fullyCosted || 0}</strong>
          <span>Fully costed</span>
        </article>
        <article>
          <strong>{summary.partiallyCosted || 0}</strong>
          <span>Partially costed</span>
        </article>
        <article>
          <strong>{summary.uncosted ?? summary.liveKitchenItems ?? 0}</strong>
          <span>Uncosted / missing cost</span>
        </article>
        <article>
          <strong>{summary.costCoveragePct || 0}%</strong>
          <span>Cost coverage</span>
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
          <span>Cost as of</span>
          <input
            type="date"
            value={costAsOf}
            onChange={(event) => setCostAsOf(event.target.value)}
            data-testid="food-bible-cost-as-of"
          />
        </label>
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
          <span>Catalogue</span>
          <select
            value={catalogueFilter}
            onChange={(event) => setCatalogueFilter(event.target.value)}
            data-testid="food-bible-menu-filter"
          >
            {CATALOGUE_FILTERS.map((filter) => (
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
        <button
          type="button"
          className="inv-button inv-button--secondary"
          onClick={handleDownloadSelected}
          disabled={!selectedKeys.size || Boolean(downloadBusy)}
          data-testid="download-selected-recipes-button"
        >
          <Download size={16} /> Download selected
        </button>
        <button
          type="button"
          className="inv-button inv-button--secondary"
          onClick={handleDownloadFoodBible}
          disabled={Boolean(downloadBusy)}
          data-testid="download-food-bible-button"
        >
          <Download size={16} /> Download Food Bible
        </button>
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

      {loading && !overview ? (
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
                <th scope="col">
                  <label className="inv-ingredients-checkbox">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all recipes"
                      data-testid="food-bible-select-all"
                    />
                    All
                  </label>
                </th>
                <th scope="col">Menu item / recipe</th>
                <th scope="col">Category</th>
                <th scope="col">Recipe status</th>
                <th scope="col">Cost status</th>
                <th scope="col">Cost / portion</th>
                <th scope="col">Type</th>
                <th scope="col">Menu status</th>
                <th scope="col">Yield</th>
                <th scope="col">Lines</th>
                <th scope="col">Last updated</th>
                <th scope="col"><span className="inv-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const costCell = foodBibleCostCell(row);
                return (
                <tr key={row.identityKey} data-testid={`food-bible-row-${row.identityKey}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(row.identityKey)}
                      disabled={!row.recipeId}
                      onChange={() => toggleSelect(row.identityKey)}
                      aria-label={`Select ${row.displayName}`}
                      data-testid={`select-recipe-${row.identityKey}`}
                    />
                  </td>
                  <td>
                    <strong>{row.displayName}</strong>
                    {row.displayNameAr ? <div className="inv-ingredients-note">{row.displayNameAr}</div> : null}
                    {row.recipeName && row.recipeName !== row.displayName ? (
                      <div className="inv-ingredients-note">{row.recipeName}</div>
                    ) : null}
                    {row.placementSummary ? (
                      <div className="inv-ingredients-note">{row.placementSummary}</div>
                    ) : row.placements?.length > 1 ? (
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
                  <td>
                    <span className="inv-status-pill inv-status-pill--missing">
                      {costCell.trust || costCell.label}
                    </span>
                  </td>
                  <td>
                    {costCell.portion != null ? formatSar(costCell.portion) : "—"}
                  </td>
                  <td>{recipeTypeLabel(row.recipeType)}</td>
                  <td>{row.guestStatus ? guestMenuStatusLabel(row.guestStatus) : "—"}</td>
                  <td>{row.yieldSummary}</td>
                  <td>{row.lineCount == null ? "—" : row.lineCount}</td>
                  <td>{formatRecipeTimestamp(row.updatedAt)}</td>
                  <td>
                    <div className="inv-fb-row-actions">
                      {row.recipeId ? (
                        <button
                          type="button"
                          className="inv-button inv-button--ghost inv-ingredients-edit"
                          onClick={() => handleDownloadRow(row)}
                          data-testid={`download-recipe-${row.identityKey}`}
                        >
                          Download PDF
                        </button>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          className="inv-button inv-button--ghost inv-ingredients-edit"
                          onClick={() => openEditor(row)}
                          data-testid={`open-recipe-editor-${row.identityKey}`}
                        >
                          {row.recipeId ? "Open card" : "Document"}
                        </button>
                      ) : row.recipeId ? (
                        <button
                          type="button"
                          className="inv-button inv-button--ghost inv-ingredients-edit"
                          onClick={() => openEditor(row)}
                          data-testid={`open-recipe-editor-${row.identityKey}`}
                        >
                          View card
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > visibleRows.length ? (
            <button
              type="button"
              className="inv-button inv-button--secondary inv-fb-load-more"
              onClick={() => setVisibleCount((count) => count + pageSize)}
              data-testid="food-bible-load-more"
            >
              Show more ({filtered.length - visibleRows.length} remaining)
            </button>
          ) : null}
        </div>
      )}

      {editorTarget ? (
        <FoodBibleCard
          branchId={branchId}
          target={editorTarget}
          overview={overview}
          canEdit={canEdit}
          onClose={closeEditor}
          onBack={editorStack.length > 1 ? goBack : null}
          breadcrumb={editorStack.map((entry) => entry.displayName).filter(Boolean)}
          getBundle={loadBundle}
          onSaved={handleSaved}
          onOpenRecipe={openComponent}
        />
      ) : null}
    </section>
  );
}
