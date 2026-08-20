import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import {
  createRecipe,
  fetchRecipeBundle,
  linkRecipeToMenuItem,
  saveRecipeDraft,
} from "../lib/inventoryApi";
import { CANONICAL_UNITS, unitLabel } from "./ingredientMaster";
import {
  DEFAULT_DOCUMENTATION,
  deriveRecipeReadiness,
  duplicateLineWarning,
  friendlyRecipeError,
  guestMenuStatusLabel,
  validateRecipeDraft,
  wouldCreateCycle,
} from "./foodBible";
import FoodBibleMenuLink from "./FoodBibleMenuLink";

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

function heroUrl(path) {
  if (!path) return "";
  if (/^https?:/i.test(path)) return path;
  const base = process.env.REACT_APP_SUPABASE_URL || "";
  return `${base}/storage/v1/object/public/menu-images/${path}`;
}

function formFromBundle(bundle, target) {
  const recipe = bundle?.recipe;
  return {
    name: recipe?.name || target?.displayName || target?.recipeName || "",
    nameEn: recipe?.nameEn || target?.displayName || "",
    nameAr: recipe?.nameAr || target?.displayNameAr || "",
    internalName: recipe?.internalName || "",
    recipeType: recipe?.recipeType || (target?.kind === "new_component" ? "preparation" : "menu_item"),
    menuItemId: recipe?.menuItemId || target?.linkedMenuItemId || "",
    placementGroupId: recipe?.placementGroupId || target?.placementGroupId || null,
    heroImagePath: recipe?.heroImagePath || target?.heroImagePath || "",
    scope: recipe?.scope || "branch",
    outputQuantity: recipe?.outputQuantity ?? "1",
    outputUnit: recipe?.outputUnit || "each",
    portionCount: recipe?.portionCount ?? "",
    portionSize: recipe?.portionSize ?? "",
    portionUnit: recipe?.portionUnit || "each",
    documentation: { ...DEFAULT_DOCUMENTATION, ...(bundle?.version?.documentation || {}) },
  };
}

export default function FoodBibleCard({
  branchId,
  target,
  overview,
  canEdit = false,
  onClose,
  onSaved,
  onOpenRecipe,
}) {
  const [editing, setEditing] = useState(!target?.recipeId);
  const [bundle, setBundle] = useState(null);
  const [form, setForm] = useState(() => formFromBundle(null, target));
  const [lines, setLines] = useState([emptyLine()]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(Boolean(target?.recipeId));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [lineSearch, setLineSearch] = useState("");

  const ingredients = useMemo(() => overview?.ingredients || [], [overview?.ingredients]);
  const components = useMemo(
    () => (overview?.recipes || []).filter((recipe) => recipe.recipeType === "preparation" && recipe.active),
    [overview?.recipes],
  );
  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients],
  );
  const recipeById = useMemo(
    () => new Map((overview?.recipes || []).map((recipe) => [recipe.id, recipe])),
    [overview?.recipes],
  );

  const load = useCallback(async () => {
    if (!target?.recipeId) {
      setForm(formFromBundle(null, target));
      setLines([emptyLine()]);
      setStages([]);
      setBundle(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await fetchRecipeBundle(target.recipeId);
      setBundle(next);
      setForm(formFromBundle(next, target));
      setLines(next.lines.length ? next.lines : [emptyLine()]);
      setStages(next.stages || []);
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not load recipe."));
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => { load(); }, [load]);

  const readiness = deriveRecipeReadiness({
    recipe: { ...form, id: bundle?.recipe?.id || target?.recipeId, menuItemId: form.menuItemId },
    version: { documentation: form.documentation },
    lines,
    ingredientById,
    recipeById,
    menuItem: form.menuItemId ? { id: form.menuItemId, active: true } : null,
  });

  const linkedName = (overview?.rows || []).find((row) => row.menuItemId === form.menuItemId)?.displayName
    || (overview?.rows || []).find((row) => row.identityKey === target?.identityKey)?.displayName
    || "";

  const menuIdentities = useMemo(() => (
    (overview?.rows || [])
      .filter((row) => row.kind === "menu_item")
      .map((row) => ({
        id: row.menuItemId,
        name: row.displayName,
        nameAr: row.displayNameAr,
        categoryName: row.categoryName,
        sectionName: row.placementSummary,
        placements: row.placements?.length > 1 ? `${row.placements.length} placements` : row.placementSummary,
        status: guestMenuStatusLabel(row.guestStatus),
        placementGroupId: row.placementGroupId,
      }))
  ), [overview?.rows]);

  const updateLine = (clientId, patch) => {
    setLines((current) => current.map((line) => {
      const id = line.clientId || line.id;
      if (id !== clientId) return line;
      const next = { ...line, ...patch };
      if (patch.ingredientId) next.subRecipeId = "";
      if (patch.subRecipeId) next.ingredientId = "";
      return next;
    }));
  };

  const handleSave = async () => {
    const valid = validateRecipeDraft(form, lines);
    if (!valid.ok) {
      setError(valid.message);
      return;
    }
    const graph = overview?.lineGraph || {};
    for (const line of lines) {
      if (line.subRecipeId && wouldCreateCycle(bundle?.recipe?.id, line.subRecipeId, graph)) {
        setError("That component would create a circular recipe.");
        return;
      }
    }
    setBusy("save");
    setError("");
    try {
      let recipeId = bundle?.recipe?.id || target?.recipeId;
      if (!recipeId) {
        const created = await createRecipe({
          ...form,
          branchId,
          menuItemId: form.menuItemId || target?.menuItemId || null,
        });
        recipeId = created.recipe.id;
        setBundle(created);
      }
      await saveRecipeDraft(recipeId, {
        ...form,
        branchId,
        version: bundle?.version,
        lines: lines.filter((line) => line.ingredientId || line.subRecipeId),
        stages,
      });
      setEditing(false);
      onSaved?.();
      await load();
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not save recipe."));
    } finally {
      setBusy("");
    }
  };

  const handleConfirmLink = async (item) => {
    if (!bundle?.recipe?.id && !target?.recipeId) {
      setForm((current) => ({ ...current, menuItemId: item.id, placementGroupId: item.placementGroupId || null }));
      setLinkOpen(false);
      return;
    }
    setBusy("link");
    try {
      await linkRecipeToMenuItem(bundle?.recipe?.id || target.recipeId, {
        menuItemId: item.id,
        placementGroupId: item.placementGroupId || null,
      });
      setLinkOpen(false);
      onSaved?.();
      await load();
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not link menu item."));
    } finally {
      setBusy("");
    }
  };

  const photo = heroUrl(form.heroImagePath);
  const doc = form.documentation || {};

  return (
    <div className="fb-card-overlay" data-testid="food-bible-card">
      <article className="fb-card">
        <header className="fb-card__toolbar">
          <button type="button" onClick={onClose} aria-label="Close recipe" data-testid="food-bible-card-close">
            <X size={18} />
          </button>
          <div>
            <p className="fb-card__kicker">NAC Food Bible</p>
            {target?.linkKind === "inferred" ? <p className="fb-card__review">Needs menu confirmation</p> : null}
          </div>
          <div className="fb-card__toolbar-actions">
            {canEdit && !editing ? (
              <button type="button" data-testid="food-bible-card-edit" onClick={() => setEditing(true)}>Edit</button>
            ) : null}
            {canEdit && editing ? (
              <button type="button" data-testid="save-recipe-button" onClick={handleSave} disabled={Boolean(busy)}>
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            ) : null}
          </div>
        </header>

        {error ? <p className="fb-card__error" data-testid="recipe-editor-error">{error}</p> : null}
        {loading ? (
          <div className="fb-card__loading"><Loader2 className="inv-spin" size={22} /> Loading card…</div>
        ) : (
          <>
            <div className="fb-card__hero">
              {photo ? (
                <img src={photo} alt="" className="fb-card__photo" data-testid="food-bible-card-photo" />
              ) : (
                <div className="fb-card__photo is-empty" data-testid="food-bible-card-photo-empty">No source photograph</div>
              )}
              <div className="fb-card__identity">
                {editing ? (
                  <input
                    data-testid="recipe-name-input"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                ) : (
                  <h2>{form.name || "Untitled recipe"}</h2>
                )}
                {form.nameAr ? <p className="fb-card__ar">{form.nameAr}</p> : null}
                <dl>
                  <div><dt>Section</dt><dd>{doc.menuSection || target?.categoryName || "—"}</dd></div>
                  <div><dt>Yield</dt><dd>
                    {editing ? (
                      <span className="fb-card__yield-edit">
                        <input data-testid="recipe-yield-quantity-input" value={form.outputQuantity} onChange={(event) => setForm((current) => ({ ...current, outputQuantity: event.target.value }))} />
                        <select value={form.outputUnit} onChange={(event) => setForm((current) => ({ ...current, outputUnit: event.target.value }))}>
                          {CANONICAL_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unitLabel(unit.value)}</option>)}
                        </select>
                      </span>
                    ) : `${form.outputQuantity || "—"} ${form.outputUnit || ""}`}
                  </dd></div>
                  <div><dt>Prep</dt><dd>{doc.prepTime || "—"}</dd></div>
                  <div><dt>Cook</dt><dd>{doc.cookTime || "—"}</dd></div>
                  <div><dt>Allergens</dt><dd>{doc.allergens || "—"}</dd></div>
                  <div><dt>Utensils</dt><dd>{doc.utensils || doc.equipmentNotes || "—"}</dd></div>
                </dl>
                <p className="fb-card__link">
                  Recipe → {form.menuItemId ? (linkedName || "Linked menu item") : "Not linked"}
                  {canEdit ? (
                    <button type="button" data-testid="food-bible-link-menu-button" onClick={() => setLinkOpen(true)}>
                      Link to menu item
                    </button>
                  ) : null}
                </p>
                <p className="fb-card__status">{readiness.readiness === "ready" ? "Complete" : readiness.readiness === "missing" ? "Missing recipe" : readiness.readiness === "needs_attention" ? "Needs attention" : "In progress"}</p>
              </div>
            </div>

            <section className="fb-card__table-wrap">
              <div className="fb-card__table-head">
                <h3>Ingredients</h3>
                {editing ? (
                  <input
                    value={lineSearch}
                    onChange={(event) => setLineSearch(event.target.value)}
                    placeholder="Search ingredients"
                    data-testid="recipe-ingredient-search"
                  />
                ) : null}
              </div>
              <table className="fb-card__table">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Quantity</th>
                    <th>Unit</th>
                    <th>Note</th>
                    {editing ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const key = line.clientId || line.id || `line-${index}`;
                    const component = line.subRecipeId ? recipeById.get(line.subRecipeId) : null;
                    const ingredient = line.ingredientId ? ingredientById.get(line.ingredientId) : null;
                    const label = component?.name || ingredient?.canonicalName || "Select…";
                    const warning = duplicateLineWarning(lines, line);
                    return (
                      <tr key={key} data-testid={`recipe-line-${index}`}>
                        <td>
                          {editing ? (
                            <select
                              data-testid={`recipe-line-item-${index}`}
                              value={line.subRecipeId ? `cmp:${line.subRecipeId}` : line.ingredientId ? `ing:${line.ingredientId}` : ""}
                              onChange={(event) => {
                                const value = event.target.value;
                                if (value.startsWith("cmp:")) updateLine(key, { subRecipeId: value.slice(4), ingredientId: "" });
                                else updateLine(key, { ingredientId: value.replace(/^ing:/, ""), subRecipeId: "" });
                              }}
                            >
                              <option value="">Select ingredient or component</option>
                              {ingredients.filter((item) => item.active && (!lineSearch || item.canonicalName.toLowerCase().includes(lineSearch.toLowerCase()))).map((item) => (
                                <option key={item.id} value={`ing:${item.id}`}>{item.canonicalName}</option>
                              ))}
                              {components.filter((item) => !lineSearch || item.name.toLowerCase().includes(lineSearch.toLowerCase())).map((item) => (
                                <option key={item.id} value={`cmp:${item.id}`}>{item.name} (component)</option>
                              ))}
                            </select>
                          ) : component ? (
                            <button type="button" className="fb-card__component" data-testid={`open-component-${component.id}`} onClick={() => onOpenRecipe?.({ ...target, recipeId: component.id, displayName: component.name, kind: "component" })}>
                              {label}
                            </button>
                          ) : label}
                          {warning ? <small>Duplicate line — add a distinguishing note</small> : null}
                        </td>
                        <td>
                          {editing ? (
                            <input
                              data-testid={`recipe-line-qty-${index}`}
                              value={line.quantity}
                              onChange={(event) => updateLine(key, { quantity: event.target.value })}
                            />
                          ) : line.quantity}
                        </td>
                        <td>
                          {editing ? (
                            <select
                              data-testid={`recipe-line-unit-${index}`}
                              value={line.unit}
                              onChange={(event) => updateLine(key, { unit: event.target.value })}
                            >
                              {CANONICAL_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unitLabel(unit.value)}</option>)}
                            </select>
                          ) : line.unit}
                        </td>
                        <td>
                          {editing ? (
                            <input
                              data-testid={`recipe-line-note-${index}`}
                              value={line.preparationNote || ""}
                              onChange={(event) => updateLine(key, { preparationNote: event.target.value })}
                            />
                          ) : line.preparationNote || ""}
                        </td>
                        {editing ? (
                          <td>
                            <button type="button" aria-label="Remove line" data-testid={`remove-recipe-line-${index}`} onClick={() => setLines((current) => current.filter((entry) => (entry.clientId || entry.id) !== key))}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {editing ? (
                <button type="button" data-testid="add-recipe-line-button" onClick={() => setLines((current) => [...current, emptyLine()])}>
                  <Plus size={14} /> Add row
                </button>
              ) : null}
              {!editing && !lines.some((line) => line.ingredientId || line.subRecipeId) ? (
                <p data-testid="food-bible-no-ingredients">No ingredients recorded</p>
              ) : null}
            </section>

            <section className="fb-card__method">
              <h3>Method</h3>
              {editing ? (
                <textarea
                  data-testid="recipe-method-input"
                  value={doc.preparationMethod || ""}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    documentation: { ...current.documentation, preparationMethod: event.target.value },
                  }))}
                />
              ) : (
                <pre>{doc.preparationMethod || "No method recorded"}</pre>
              )}
              {doc.platingInstructions ? (
                <>
                  <h3>To serve</h3>
                  <pre>{doc.platingInstructions}</pre>
                </>
              ) : null}
              {doc.qualityCheckpoints ? (
                <>
                  <h3>Critical control</h3>
                  <pre>{doc.qualityCheckpoints}</pre>
                </>
              ) : null}
            </section>
          </>
        )}
      </article>
      <FoodBibleMenuLink
        open={linkOpen}
        currentRecipeName={form.name}
        currentLinkName={form.menuItemId ? linkedName : ""}
        identities={menuIdentities}
        onCancel={() => setLinkOpen(false)}
        onConfirm={handleConfirmLink}
      />
    </div>
  );
}
