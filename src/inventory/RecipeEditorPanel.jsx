import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  activateRecipeVersion,
  createRecipe,
  fetchRecipeBundle,
  fetchRecipeCostTrust,
  fetchRecipeUsageCounts,
  saveRecipeDraft,
  setRecipeActive,
} from "../lib/inventoryApi";
import {
  CANONICAL_UNITS,
  unitLabel,
} from "./ingredientMaster";
import {
  DEFAULT_DOCUMENTATION,
  READINESS_LABELS,
  RECIPE_TYPES,
  STAGE_PRESETS,
  deriveRecipeReadiness,
  duplicateLineWarning,
  friendlyRecipeError,
  recipeTypeLabel,
  validateRecipeDraft,
  wouldCreateCycle,
  yieldSummary,
} from "./foodBible";
import { costTrustLabel, formatSar } from "./costTrust";
import { classifyRecipeCosting, computeLineCost, recipeCostDelta, withFoodCostPct } from "./recipeGraph";

function emptyLine() {
  return {
    clientId: `line-${Math.random().toString(36).slice(2, 9)}`,
    ingredientId: "",
    subRecipeId: "",
    quantity: "",
    unit: "gram",
    preparationNote: "",
    isOptional: false,
    wastePercentage: "0",
    stageId: "",
  };
}

function emptyStage(name = "") {
  return {
    clientId: `stage-${Math.random().toString(36).slice(2, 9)}`,
    name,
  };
}

function formFromBundle(bundle, target) {
  const recipe = bundle?.recipe;
  return {
    name: recipe?.name || target?.displayName || "",
    nameEn: recipe?.nameEn || target?.displayName || "",
    nameAr: recipe?.nameAr || target?.displayNameAr || "",
    internalName: recipe?.internalName || "",
    recipeType: recipe?.recipeType
      || target?.suggestedRecipeType
      || (target?.kind === "new_component" ? "preparation" : "menu_item"),
    menuItemId: recipe?.menuItemId || target?.menuItemId || "",
    placementGroupId: recipe?.placementGroupId || target?.placementGroupId || null,
    scope: recipe?.scope || "branch",
    outputQuantity: bundle?.version?.outputQuantity ?? recipe?.outputQuantity ?? "1",
    outputUnit: bundle?.version?.outputUnit || recipe?.outputUnit || "each",
    portionCount: bundle?.version?.portionCount ?? recipe?.portionCount ?? "",
    portionSize: bundle?.version?.portionSize ?? recipe?.portionSize ?? "",
    portionUnit: bundle?.version?.portionUnit || recipe?.portionUnit || "each",
    documentation: { ...DEFAULT_DOCUMENTATION, ...(bundle?.version?.documentation || {}) },
  };
}

function snapshotEditor(form, lines, stages, version) {
  return JSON.stringify({ form, lines, stages, versionId: version?.id || null });
}

export default function RecipeEditorPanel({
  branchId,
  target,
  overview,
  canEditBranch,
  canEditNetwork,
  onClose,
  onSaved,
}) {
  const [bundle, setBundle] = useState(null);
  const [form, setForm] = useState(() => formFromBundle(null, target));
  const [lines, setLines] = useState([emptyLine()]);
  const [stages, setStages] = useState([]);
  const [usageCounts, setUsageCounts] = useState({});
  const [costTrust, setCostTrust] = useState(null);
  const [loading, setLoading] = useState(Boolean(target?.recipeId));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [openSections, setOpenSections] = useState({
    identification: true,
    yield: true,
    lines: true,
    documentation: false,
    readiness: true,
  });
  const [applyNow, setApplyNow] = useState(true);
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ingredientQuery, setIngredientQuery] = useState("");
  const baselineRef = useRef(snapshotEditor(form, lines, stages, null));

  const canEdit = canEditBranch || canEditNetwork;
  const ingredients = useMemo(() => overview?.ingredients || [], [overview?.ingredients]);
  const activeIngredients = ingredients.filter((ingredient) => ingredient.active);
  const visibleIngredients = activeIngredients.filter((ingredient) => {
    const query = ingredientQuery.trim().toLowerCase();
    if (!query) return true;
    return `${ingredient.canonicalName} ${ingredient.normalizedSearchName || ""}`.toLowerCase().includes(query);
  });
  const componentRecipes = (overview?.recipes || []).filter(
    (recipe) => recipe.recipeType === "preparation" && recipe.active,
  );

  const load = useCallback(async () => {
    if (!target?.recipeId) {
      const initialForm = formFromBundle(null, target);
      const initialLines = [emptyLine()];
      setForm(initialForm);
      setLines(initialLines);
      setStages([]);
      setBundle(null);
      setCostTrust(null);
      baselineRef.current = snapshotEditor(initialForm, initialLines, [], null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextBundle = await fetchRecipeBundle(target.recipeId);
      const nextForm = formFromBundle(nextBundle, target);
      const nextLines = nextBundle.lines.length ? nextBundle.lines : [emptyLine()];
      const nextStages = nextBundle.stages || [];
      setBundle(nextBundle);
      setForm(nextForm);
      setLines(nextLines);
      setStages(nextStages);
      baselineRef.current = snapshotEditor(nextForm, nextLines, nextStages, nextBundle.version);
      const [counts, nextCostTrust] = await Promise.all([
        fetchRecipeUsageCounts([target.recipeId]),
        fetchRecipeCostTrust({
          recipeId: target.recipeId,
          branchId,
          asOf: overview?.costAsOf,
          recipeVersionId: nextBundle.version?.id || null,
        }).catch(() => null),
      ]);
      setUsageCounts(counts);
      setCostTrust(nextCostTrust);
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not load recipe."));
    } finally {
      setLoading(false);
    }
  }, [target, branchId, overview?.costAsOf]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  });

  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients],
  );
  const recipeById = useMemo(
    () => new Map((overview?.recipes || []).map((recipe) => [recipe.id, recipe])),
    [overview?.recipes],
  );

  const allLinesByRecipeId = useMemo(() => {
    const map = {};
    for (const recipe of overview?.recipes || []) {
      map[recipe.id] = overview?.lineGraph?.[recipe.id] || [];
    }
    if (bundle?.recipe?.id) map[bundle.recipe.id] = lines;
    return map;
  }, [overview?.recipes, overview?.lineGraph, bundle?.recipe?.id, lines]);

  const readiness = useMemo(() => deriveRecipeReadiness({
    recipe: {
      id: bundle?.recipe?.id || "draft",
      ...form,
      recipeType: form.recipeType,
    },
    version: { documentation: form.documentation },
    lines,
    ingredientById,
    recipeById,
    menuItem: target?.placements?.[0] || null,
    cycleDetected: lines.some(
      (line) => line.subRecipeId && wouldCreateCycle(bundle?.recipe?.id || "draft", line.subRecipeId, allLinesByRecipeId),
    ),
  }), [bundle, form, lines, ingredientById, recipeById, target, allLinesByRecipeId]);

  const liveCosting = useMemo(() => {
    const costByIngredientId = { ...(overview?.costByCanonicalId || {}) };
    for (const line of costTrust?.lines || []) {
      const match = activeIngredients.find((ingredient) => ingredient.canonicalName === line.itemName);
      const id = line.ingredientId || match?.id;
      if (!id || line.historicalUnitCost == null || line.historicalUnitCost === "") continue;
      costByIngredientId[id] = {
        amount: line.historicalUnitCost,
        unit: line.normalizedBaseUnit || costByIngredientId[id]?.unit || "each",
      };
    }
    const nestedCostByRecipeId = {};
    const costing = classifyRecipeCosting({ lines, costByIngredientId, nestedCostByRecipeId });
    const sellingPrice = target?.placements?.[0]?.price || target?.cost?.sellingPrice;
    return withFoodCostPct(costing, sellingPrice);
  }, [costTrust, lines, activeIngredients, target, overview?.costByCanonicalId]);

  const costDelta = recipeCostDelta(
    costTrust?.costPerPortion ?? costTrust?.outputUnitCost,
    liveCosting.state === "fully costed" ? liveCosting.total : null,
  );

  const isDirty = () => snapshotEditor(form, lines, stages, bundle?.version) !== baselineRef.current;

  const requestClose = () => {
    if (busy) return;
    if (isDirty()) {
      const confirmed = window.confirm("You have unsaved changes. Leave anyway?");
      if (!confirmed) return;
    }
    onClose();
  };

  const toggleSection = (section) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const updateLine = (clientId, patch) => {
    setLines((prev) => prev.map((line) => (line.clientId === clientId || line.id === clientId
      ? { ...line, ...patch }
      : line)));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!canEdit || busy) return;
    const validation = validateRecipeDraft(form, lines);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    for (const line of lines) {
      if (line.subRecipeId && wouldCreateCycle(bundle?.recipe?.id || "draft", line.subRecipeId, allLinesByRecipeId)) {
        setError("One of the selected components would create a circular dependency.");
        return;
      }
    }
    setBusy("save");
    setError("");
    try {
      const payload = {
        ...form,
        branchId,
        scope: form.scope,
        documentation: form.documentation,
        stages,
        lines: lines.filter((line) => line.ingredientId || line.subRecipeId),
        ingredients: activeIngredients,
        version: bundle?.version,
      };
      let recipeId = bundle?.recipe?.id;
      let saved = null;
      if (recipeId) {
        saved = await saveRecipeDraft(recipeId, payload);
      } else {
        const created = await createRecipe({
          ...form,
          branchId,
          scope: form.scope,
          menuItemId: form.menuItemId || target?.menuItemId || null,
          placementGroupId: form.placementGroupId || target?.placementGroupId || null,
          documentation: form.documentation,
        });
        recipeId = created.recipe.id;
        saved = await saveRecipeDraft(recipeId, {
          ...payload,
          version: created.version,
        });
      }
      if (applyNow && saved?.version?.id && saved.version.status === "draft") {
        await activateRecipeVersion({
          recipeVersionId: saved.version.id,
          effectiveFrom: `${effectiveDate}T00:00:00+03:00`,
          reason: "Save changes — effective now",
        });
      }
      onSaved();
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not save recipe."));
    } finally {
      setBusy("");
    }
  };

  const handleDeactivate = async () => {
    if (!bundle?.recipe?.id || busy) return;
    const confirmed = window.confirm(`Deactivate "${form.name}"?\n\nHistorical records will be preserved.`);
    if (!confirmed) return;
    setBusy("deactivate");
    try {
      await setRecipeActive(bundle.recipe.id, false);
      onSaved();
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not deactivate recipe."));
    } finally {
      setBusy("");
    }
  };

  const handlePublish = async () => {
    if (!bundle?.version?.id || bundle.version.status !== "draft" || busy) return;
    if (isDirty()) {
      setError("Save the draft before activating this recipe version.");
      return;
    }
    const reason = window.prompt("Reason for activating this recipe version:");
    if (!reason?.trim()) return;
    const effectiveDate = window.prompt(
      "Effective business date (YYYY-MM-DD):",
      new Date().toISOString().slice(0, 10),
    );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate || "")) {
      setError("Enter a valid effective business date.");
      return;
    }
    setBusy("publish");
    setError("");
    try {
      await activateRecipeVersion({
        recipeVersionId: bundle.version.id,
        effectiveFrom: `${effectiveDate}T00:00:00+03:00`,
        reason: reason.trim(),
      });
      onSaved();
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not activate recipe version."));
    } finally {
      setBusy("");
    }
  };

  const menuPlacements = target?.placements || [];

  return (
    <div className="inv-ingredients-panel-backdrop" onClick={requestClose} role="presentation">
      <aside
        className="inv-ingredients-panel inv-fb-editor"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Recipe editor"
        data-testid="recipe-editor-panel"
      >
        <header className="inv-ingredients-panel-header">
          <div>
            <p className="inv-kicker">Food Bible</p>
            <h2>{bundle?.recipe?.id ? "Edit recipe" : "Document recipe"}</h2>
            <p className="inv-fb-editor-subtitle">
              {READINESS_LABELS[readiness.readiness]} · {recipeTypeLabel(form.recipeType)}
            </p>
          </div>
          <button type="button" className="inv-button inv-button--ghost" onClick={requestClose} aria-label="Close editor">
            <X size={16} />
          </button>
        </header>

        {loading ? (
          <div className="inv-ingredients-state">
            <Loader2 size={22} className="inv-spin" />
            Loading recipe…
          </div>
        ) : (
          <form className="inv-fb-editor-form" onSubmit={handleSave}>
            {error ? (
              <div className="inv-banner inv-banner--error" data-testid="recipe-editor-error">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            ) : null}

            <section className="inv-fb-section" data-testid="recipe-cost-delta">
              <div className="inv-fb-section-heading">
                <div>
                  <h3>Recipe cost</h3>
                  <p data-testid="recipe-costing-state">{liveCosting.state}</p>
                </div>
              </div>
              <div className="inv-fb-summary inv-fb-cost-delta">
                <article>
                  <strong>{formatSar(liveCosting.total ?? liveCosting.knownSubtotal)}</strong>
                  <span>{liveCosting.state === "fully costed" ? "Recipe cost" : "Known subtotal"}</span>
                </article>
                <article>
                  <strong>{liveCosting.foodCostPct == null ? "Unavailable" : `${Number(liveCosting.foodCostPct).toFixed(1)}%`}</strong>
                  <span>Food cost %</span>
                </article>
                <article>
                  <strong>{liveCosting.missing?.length || 0}</strong>
                  <span>Missing-cost ingredients</span>
                </article>
                <article>
                  <strong>{liveCosting.coveragePct ?? 0}%</strong>
                  <span>Ingredient cost coverage</span>
                </article>
                <article>
                  <strong>
                    {costDelta.difference == null
                      ? "Unavailable"
                      : `${costDelta.difference > 0 ? "+" : ""}${formatSar(costDelta.difference)}`}
                  </strong>
                  <span>Vs last trusted cost</span>
                </article>
              </div>
              {liveCosting.state === "partially costed" ? (
                <div className="inv-banner inv-banner--error" data-testid="recipe-missing-cost-banner">
                  <AlertTriangle size={16} />
                  <span>
                    Missing cost: {(liveCosting.missing || [])
                      .map((item) => item.name || item.ingredientId || item.code)
                      .filter(Boolean)
                      .join(", ") || "one or more ingredients"}
                  </span>
                </div>
              ) : null}
            </section>

            {costTrust ? (
              <section className="inv-fb-section" data-testid="recipe-cost-trust-detail">
                <div className="inv-fb-section-heading">
                  <div>
                    <h3>Historical cost · {costTrust.businessDate}</h3>
                    <p>
                      {costTrustLabel(costTrust.trustStatus)} · {costTrust.completenessPct}% complete
                    </p>
                  </div>
                </div>
                <div className="inv-fb-summary">
                  <article>
                    <strong>{formatSar(costTrust.totalCost)}</strong>
                    <span>Batch cost</span>
                  </article>
                  <article>
                    <strong>{formatSar(costTrust.costPerPortion ?? costTrust.outputUnitCost)}</strong>
                    <span>Cost per portion/output</span>
                  </article>
                  <article>
                    <strong>{costTrust.resolvedLines}/{costTrust.totalCostBearingLines}</strong>
                    <span>Resolved cost lines</span>
                  </article>
                </div>
                {costTrust.missingComponents?.length ? (
                  <div className="inv-banner inv-banner--error">
                    <AlertTriangle size={16} />
                    <span>
                      Missing: {costTrust.missingComponents
                        .map((component) => component.itemName || component.recipeName || component.status)
                        .join(", ")}
                    </span>
                  </div>
                ) : null}
                {costTrust.lines?.length ? (
                  <div className="inv-ingredients-table-wrap">
                    <table className="inv-ingredients-table">
                      <thead>
                        <tr>
                          <th scope="col">Component</th>
                          <th scope="col">Base quantity</th>
                          <th scope="col">Unit cost</th>
                          <th scope="col">Line cost</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costTrust.lines.map((line) => (
                          <tr key={line.lineId}>
                            <td>{line.itemName || line.componentCost?.recipeName || "Component"}</td>
                            <td>{line.normalizedBaseQuantity} {line.normalizedBaseUnit}</td>
                            <td>{formatSar(line.historicalUnitCost)}</td>
                            <td>{formatSar(line.extendedLineCost)}</td>
                            <td>{line.costStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ) : null}

            {isDirty() ? (
              <p className="inv-fb-unsaved" data-testid="recipe-unsaved-indicator">Unsaved changes</p>
            ) : null}

            <section className="inv-fb-section">
              <button type="button" className="inv-fb-section-toggle" onClick={() => toggleSection("readiness")}>
                <span>Readiness checklist</span>
                {openSections.readiness ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.readiness ? (
                <ul className="inv-fb-checklist" data-testid="recipe-readiness-checklist">
                  {readiness.checklist.map((item) => (
                    <li key={item.id} className={item.complete ? "is-complete" : ""}>
                      {item.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="inv-fb-section">
              <button type="button" className="inv-fb-section-toggle" onClick={() => toggleSection("identification")}>
                <span>Identification</span>
                {openSections.identification ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.identification ? (
                <div className="inv-fb-section-body">
                  <label>
                    <span>Recipe name</span>
                    <input
                      value={form.name}
                      onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                      required
                      data-testid="recipe-name-input"
                    />
                  </label>
                  <label>
                    <span>English name</span>
                    <input
                      value={form.nameEn}
                      onChange={(event) => setForm((prev) => ({ ...prev, nameEn: event.target.value }))}
                      data-testid="recipe-name-en-input"
                    />
                  </label>
                  <label>
                    <span>Arabic name</span>
                    <input
                      value={form.nameAr}
                      onChange={(event) => setForm((prev) => ({ ...prev, nameAr: event.target.value }))}
                      data-testid="recipe-name-ar-input"
                    />
                  </label>
                  <label>
                    <span>Internal preparation name</span>
                    <input
                      value={form.internalName}
                      onChange={(event) => setForm((prev) => ({ ...prev, internalName: event.target.value }))}
                      placeholder="Optional kitchen shorthand"
                    />
                  </label>
                  <label>
                    <span>Recipe type</span>
                    <select
                      value={form.recipeType}
                      onChange={(event) => setForm((prev) => ({ ...prev, recipeType: event.target.value }))}
                      data-testid="recipe-type-select"
                    >
                      {RECIPE_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                  </label>
                  {(form.recipeType === "menu_item" || form.recipeType === "direct_stock") && target?.menuItemId ? (
                    <div className="inv-fb-readonly-block" data-testid="recipe-linked-menu-item">
                      <span>Linked menu item</span>
                      <strong>{target.displayName}</strong>
                      {menuPlacements.length > 1 ? (
                        <p>Also appears in {menuPlacements.length - 1} other menu section{menuPlacements.length > 2 ? "s" : ""} (read-only)</p>
                      ) : null}
                    </div>
                  ) : null}
                  {canEditNetwork ? (
                    <label>
                      <span>Availability</span>
                      <select
                        value={form.scope}
                        onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value }))}
                      >
                        <option value="branch">This branch only</option>
                        <option value="network">Network-wide</option>
                      </select>
                    </label>
                  ) : null}
                  {bundle?.recipe?.id && usageCounts[bundle.recipe.id] ? (
                    <p className="inv-ingredients-help">Used in {usageCounts[bundle.recipe.id]} recipe(s)</p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="inv-fb-section">
              <button type="button" className="inv-fb-section-toggle" onClick={() => toggleSection("yield")}>
                <span>Yield and portions</span>
                {openSections.yield ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.yield ? (
                <div className="inv-fb-section-body inv-fb-grid">
                  <label>
                    <span>Batch yield quantity</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.outputQuantity}
                      onChange={(event) => setForm((prev) => ({ ...prev, outputQuantity: event.target.value }))}
                      data-testid="recipe-yield-quantity-input"
                    />
                  </label>
                  <label>
                    <span>Yield unit</span>
                    <select
                      value={form.outputUnit}
                      onChange={(event) => setForm((prev) => ({ ...prev, outputUnit: event.target.value }))}
                      data-testid="recipe-yield-unit-select"
                    >
                      {CANONICAL_UNITS.map((unit) => (
                        <option key={unit.value} value={unit.value}>{unit.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Number of portions</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.portionCount}
                      onChange={(event) => setForm((prev) => ({ ...prev, portionCount: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Portion size</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.portionSize}
                      onChange={(event) => setForm((prev) => ({ ...prev, portionSize: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Portion unit</span>
                    <select
                      value={form.portionUnit}
                      onChange={(event) => setForm((prev) => ({ ...prev, portionUnit: event.target.value }))}
                    >
                      {CANONICAL_UNITS.map((unit) => (
                        <option key={unit.value} value={unit.value}>{unit.label}</option>
                      ))}
                    </select>
                  </label>
                  <p className="inv-ingredients-help inv-fb-grid-full">{yieldSummary(form)}</p>
                  <p className="inv-ingredients-help inv-fb-grid-full">
                    Recipe units must stay compatible with each ingredient&apos;s inventory base unit in v1.
                  </p>
                </div>
              ) : null}
            </section>

            <section className="inv-fb-section">
              <button type="button" className="inv-fb-section-toggle" onClick={() => toggleSection("lines")}>
                <span>Ingredients and components</span>
                {openSections.lines ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.lines ? (
                <div className="inv-fb-section-body">
                  {!activeIngredients.length ? (
                    <p className="inv-ingredients-warning" data-testid="recipe-no-ingredients-warning">
                      No active ingredients yet. Add ingredients in Ingredient Master first.
                    </p>
                  ) : (
                    <label className="inv-fb-ingredient-search">
                      <span>Search ingredients</span>
                      <input
                        type="search"
                        value={ingredientQuery}
                        onChange={(event) => setIngredientQuery(event.target.value)}
                        placeholder="Type to find an ingredient"
                        data-testid="recipe-ingredient-search"
                      />
                    </label>
                  )}
                  <div className="inv-fb-stage-toolbar">
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        if (!event.target.value) return;
                        setStages((prev) => [...prev, emptyStage(event.target.value)]);
                        event.target.value = "";
                      }}
                    >
                      <option value="">Add preparation stage</option>
                      {STAGE_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>{preset}</option>
                      ))}
                    </select>
                  </div>
                  {lines.length === 0 ? (
                    <p data-testid="recipe-lines-empty-state">No ingredient lines yet.</p>
                  ) : null}
                  {lines.map((line, index) => {
                    const lineKey = line.clientId || line.id || index;
                    const duplicate = duplicateLineWarning(lines.filter((entry) => entry !== line), line);
                    const ingredient = ingredientById.get(line.ingredientId);
                    const lineCost = computeLineCost(line, overview?.costByCanonicalId || {});
                    return (
                      <div key={lineKey} className="inv-fb-line" data-testid={`recipe-line-${index}`}>
                        <label>
                          <span>Ingredient or component</span>
                          <select
                            value={line.ingredientId ? `ing:${line.ingredientId}` : line.subRecipeId ? `cmp:${line.subRecipeId}` : ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (!value) {
                                updateLine(lineKey, { ingredientId: "", subRecipeId: "" });
                                return;
                              }
                              if (value.startsWith("ing:")) {
                                const ingredientId = value.slice(4);
                                const selected = ingredientById.get(ingredientId);
                                updateLine(lineKey, {
                                  ingredientId,
                                  subRecipeId: "",
                                  unit: selected?.baseInventoryUnit || line.unit,
                                });
                                return;
                              }
                              const subRecipeId = value.slice(4);
                              if (wouldCreateCycle(bundle?.recipe?.id || "draft", subRecipeId, allLinesByRecipeId)) {
                                setError("That component would create a circular dependency.");
                                return;
                              }
                              updateLine(lineKey, { ingredientId: "", subRecipeId });
                            }}
                          >
                            <option value="">Choose ingredient or component</option>
                            <optgroup label="Ingredients">
                              {visibleIngredients.map((entry) => (
                                <option key={entry.id} value={`ing:${entry.id}`}>
                                  {entry.canonicalName} · base {unitLabel(entry.baseInventoryUnit)}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Prepared components">
                              {componentRecipes.filter((recipe) => recipe.id !== bundle?.recipe?.id).map((recipe) => (
                                <option key={recipe.id} value={`cmp:${recipe.id}`}>{recipe.name}</option>
                              ))}
                            </optgroup>
                          </select>
                        </label>
                        <label>
                          <span>Quantity</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.quantity}
                            data-testid={`recipe-line-quantity-${index}`}
                            onChange={(event) => updateLine(lineKey, { quantity: event.target.value })}
                          />
                        </label>
                        <label>
                          <span>Unit</span>
                          <select
                            value={line.unit}
                            onChange={(event) => updateLine(lineKey, { unit: event.target.value })}
                          >
                            {CANONICAL_UNITS.map((unit) => (
                              <option key={unit.value} value={unit.value}>{unit.label}</option>
                            ))}
                          </select>
                        </label>
                        {ingredient ? (
                          <p className="inv-ingredients-help">Inventory base unit: {unitLabel(ingredient.baseInventoryUnit)}</p>
                        ) : null}
                        <p className="inv-ingredients-help" data-testid={`recipe-line-cost-${index}`}>
                          {lineCost.status === "COSTED"
                            ? `Line cost ${formatSar(lineCost.amount)}`
                            : "Missing cost"}
                        </p>
                        {stages.length ? (
                          <label>
                            <span>Stage</span>
                            <select
                              value={line.stageId || ""}
                              onChange={(event) => updateLine(lineKey, { stageId: event.target.value })}
                            >
                              <option value="">No stage</option>
                              {stages.map((stage) => (
                                <option key={stage.clientId || stage.id} value={stage.clientId || stage.id}>{stage.name}</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        <label>
                          <span>Preparation note</span>
                          <input
                            value={line.preparationNote || ""}
                            onChange={(event) => updateLine(lineKey, { preparationNote: event.target.value })}
                          />
                        </label>
                        <label className="inv-check">
                          <input
                            type="checkbox"
                            checked={Boolean(line.isOptional)}
                            onChange={(event) => updateLine(lineKey, { isOptional: event.target.checked })}
                          />
                          Optional line
                        </label>
                        <label>
                          <span>Waste %</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={line.wastePercentage ?? "0"}
                            onChange={(event) => updateLine(lineKey, { wastePercentage: event.target.value })}
                          />
                        </label>
                        {duplicate ? (
                          <p className="inv-ingredients-warning" data-testid="recipe-duplicate-line-warning">
                            This ingredient appears more than once. Add a preparation note if the duplicate is intentional.
                          </p>
                        ) : null}
                        {ingredient && !ingredient.active ? (
                          <p className="inv-ingredients-warning">This ingredient is inactive.</p>
                        ) : null}
                        <button
                          type="button"
                          className="inv-button inv-button--ghost"
                          onClick={() => setLines((prev) => prev.filter((entry) => (entry.clientId || entry.id) !== (line.clientId || line.id)))}
                          data-testid={`remove-recipe-line-${index}`}
                        >
                          <Trash2 size={14} /> Remove line
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="inv-button inv-button--secondary"
                    onClick={() => setLines((prev) => [...prev, emptyLine()])}
                    data-testid="add-recipe-line-button"
                  >
                    <Plus size={14} /> Add line
                  </button>
                </div>
              ) : null}
            </section>

            <section className="inv-fb-section">
              <button type="button" className="inv-fb-section-toggle" onClick={() => toggleSection("documentation")}>
                <span>Documentation</span>
                {openSections.documentation ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {openSections.documentation ? (
                <div className="inv-fb-section-body">
                  {[
                    ["preparationMethod", "Preparation method"],
                    ["cookingInstructions", "Cooking instructions"],
                    ["platingInstructions", "Plating instructions"],
                    ["storageInstructions", "Storage instructions"],
                    ["equipmentNotes", "Equipment notes"],
                    ["qualityCheckpoints", "Quality checkpoints"],
                    ["internalNotes", "Internal notes"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <textarea
                        rows={3}
                        value={form.documentation[key] || ""}
                        onChange={(event) => setForm((prev) => ({
                          ...prev,
                          documentation: { ...prev.documentation, [key]: event.target.value },
                        }))}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </section>

            <div className="inv-ingredients-form-actions">
              {bundle?.recipe?.active !== false ? (
                <button
                  type="button"
                  className="inv-button inv-button--danger"
                  onClick={handleDeactivate}
                  disabled={Boolean(busy) || !bundle?.recipe?.id}
                  data-testid="deactivate-recipe-button"
                >
                  Archive
                </button>
              ) : null}
              <div className="inv-ingredients-form-actions-right">
                <label className="inv-check">
                  <input
                    type="checkbox"
                    checked={applyNow}
                    onChange={(event) => setApplyNow(event.target.checked)}
                    data-testid="recipe-apply-now"
                  />
                  Save changes — effective now
                </label>
                <label>
                  <span>Effective date</span>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(event) => setEffectiveDate(event.target.value)}
                    data-testid="recipe-effective-date"
                  />
                </label>
                <button type="button" className="inv-button inv-button--ghost" onClick={requestClose} disabled={Boolean(busy)}>
                  Cancel
                </button>
                {bundle?.version?.status === "draft" && !applyNow ? (
                  <button
                    type="button"
                    className="inv-button inv-button--secondary"
                    onClick={handlePublish}
                    disabled={Boolean(busy) || !canEdit}
                    data-testid="activate-recipe-version-button"
                  >
                    {busy === "publish" ? <Loader2 size={16} className="inv-spin" /> : null}
                    Activate version
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="inv-button inv-button--primary"
                  disabled={Boolean(busy) || !canEdit}
                  data-testid="save-recipe-button"
                >
                  {busy === "save" ? <Loader2 size={16} className="inv-spin" /> : null}
                  {applyNow ? "Save — effective now" : "Save draft"}
                </button>
              </div>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
