import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronUp, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  activateRecipeVersion,
  createIngredient,
  createRecipe,
  evaluateRecipeActivation,
  fetchRecipeBundle,
  linkRecipeToMenuItem,
  saveRecipeDraft,
} from "../lib/inventoryApi";
import { uploadMenuImage } from "../lib/menuApi";
import { componentOpenTarget } from "./foodBibleCardNav";
import { CANONICAL_UNITS, recipeUnitShort, unitLabel } from "./ingredientMaster";
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
import FoodBiblePhotoEditor, { normalizeHeroCrop } from "./FoodBiblePhotoEditor";
import { compareDraftToSource } from "./truth/sourceEvidence";
import sourceCatalog from "./truth/sourceEvidence.catalog.json";
import { classifyRecipeLineKind, RECIPE_LINE_KIND } from "./truth/recipeLineKind";
import { mustForkNewDraft } from "./truth/recipeActivation";
import {
  OPERATIONAL_CHANGE_REASONS,
  formatSourceDiff,
  formatStaffValidationMessage,
  sourceDiffRequiresAcknowledgement,
} from "./truth/recipeValidityContract";

const WORKSPACES = [
  { id: "ingredients", label: "Ingredients" },
  { id: "method", label: "Method" },
  { id: "details", label: "Details" },
];

function emptyLine(kind = "ingredient") {
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
    lineKind: kind,
  };
}

function formatVersionWhen(value) {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  return new Date(time).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function versionReasonLabel(version) {
  const reason = version?.documentation?.operationalChange?.reason
    || version?.documentation?.operational_change?.reason
    || "";
  const match = OPERATIONAL_CHANGE_REASONS.find((item) => item.value === reason);
  return match?.label || (reason ? String(reason) : "—");
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
    heroImagePath: recipe?.heroImagePath || (target?.kind === "component" ? "" : (target?.heroImagePath || "")),
    scope: recipe?.scope || "branch",
    outputQuantity: recipe?.outputQuantity ?? "1",
    outputUnit: recipe?.outputUnit || "each",
    portionCount: recipe?.portionCount ?? "",
    portionSize: recipe?.portionSize ?? "",
    portionUnit: recipe?.portionUnit || "each",
    documentation: { ...DEFAULT_DOCUMENTATION, ...(bundle?.version?.documentation || {}) },
  };
}

function completenessLabel(readiness) {
  if (readiness === "ready") return "Complete";
  if (readiness === "missing") return "Missing recipe";
  if (readiness === "needs_attention") return "Needs attention";
  return "In progress";
}

function versionLifecycleLabel(status) {
  const value = String(status || "draft").toLowerCase();
  if (value === "active") return "ACTIVE";
  if (value === "retired") return "RETIRED";
  return "DRAFT";
}

export default function FoodBibleCard({
  branchId,
  target,
  overview,
  canEdit = false,
  onClose,
  onSaved,
  onOpenRecipe,
  onBack,
  breadcrumb = [],
  getBundle,
}) {
  const [editing, setEditing] = useState(!target?.recipeId);
  const [workspace, setWorkspace] = useState("ingredients");
  const [bundle, setBundle] = useState(null);
  const [form, setForm] = useState(() => formFromBundle(null, target));
  const [savedForm, setSavedForm] = useState(() => formFromBundle(null, target));
  const [lines, setLines] = useState([emptyLine()]);
  const [savedLines, setSavedLines] = useState([emptyLine()]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(Boolean(target?.recipeId));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [lineSearch, setLineSearch] = useState("");
  const [newIngredientUnit, setNewIngredientUnit] = useState("gram");
  const [createdIngredients, setCreatedIngredients] = useState([]);
  const [activationBlockers, setActivationBlockers] = useState([]);
  const [activationNote, setActivationNote] = useState("");
  const [activationReason, setActivationReason] = useState("");
  const [sourceAcknowledged, setSourceAcknowledged] = useState(false);
  const [sourceDiffOpen, setSourceDiffOpen] = useState(false);
  const [versionPane, setVersionPane] = useState("current");
  const [viewedVersionId, setViewedVersionId] = useState(null);
  const [conversionNotes, setConversionNotes] = useState([]);
  const [validationDetailsOpen, setValidationDetailsOpen] = useState(false);

  const ingredients = useMemo(() => {
    const seen = new Set();
    return [...(overview?.ingredients || []), ...createdIngredients].filter((ingredient) => {
      if (!ingredient?.id || seen.has(ingredient.id)) return false;
      seen.add(ingredient.id);
      return true;
    });
  }, [overview?.ingredients, createdIngredients]);
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
    const applyBundle = (next) => {
      const nextForm = formFromBundle(next, target);
      const nextLines = next?.lines?.length ? next.lines : [emptyLine()];
      setBundle(next);
      setForm(nextForm);
      setSavedForm(nextForm);
      setLines(nextLines);
      setSavedLines(nextLines);
      setStages(next?.stages || []);
      setViewedVersionId(next?.version?.id || null);
      setVersionPane("current");
      setSourceDiffOpen(false);
      setConversionNotes([]);
      setValidationDetailsOpen(false);
    };
    if (!target?.recipeId) {
      applyBundle(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await (getBundle || fetchRecipeBundle)(target.recipeId);
      applyBundle(await Promise.resolve(next));
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not load recipe."));
    } finally {
      setLoading(false);
    }
  }, [target, getBundle]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      document.documentElement.style.overflow = "";
    };
  }, []);

  const readiness = deriveRecipeReadiness({
    recipe: { ...form, id: bundle?.recipe?.id || target?.recipeId, menuItemId: form.menuItemId },
    version: { documentation: form.documentation },
    lines,
    ingredientById,
    recipeById,
    menuItem: form.menuItemId ? { id: form.menuItemId, active: true } : null,
  });
  const versionStatus = versionLifecycleLabel(bundle?.version?.status);
  const sourceEvidence = useMemo(() => compareDraftToSource({
    recipeName: form.name,
    draftLines: lines.map((line) => ({
      name: recipeById.get(line.subRecipeId)?.name || ingredientById.get(line.ingredientId)?.canonicalName || line.name,
      qty: line.quantity,
      unit: line.unit,
    })),
    catalog: sourceCatalog,
  }), [form.name, lines, recipeById, ingredientById]);
  const sourceDiff = useMemo(() => formatSourceDiff(sourceEvidence.differences || []), [sourceEvidence.differences]);
  const needsSourceAck = sourceDiffRequiresAcknowledgement(sourceEvidence.class);
  const canActivate = Boolean(activationReason) && (!needsSourceAck || sourceAcknowledged);
  const allVersions = bundle?.versions || (bundle?.version ? [bundle.version] : []);
  const viewingHistorical = Boolean(viewedVersionId && bundle?.version?.id && viewedVersionId !== bundle.version.id);
  const draftVersions = allVersions.filter((version) => String(version.status || "").toLowerCase() === "draft");
  const historyVersions = allVersions.filter((version) => {
    const status = String(version.status || "").toLowerCase();
    return status === "retired" || (status === "active" && version.id !== bundle?.version?.id);
  });
  const sourcePdf = sourceEvidence.sourceDish?.pdf || "NAC Food Bible · Aug 2026";

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

  const moveLine = (index, delta) => {
    setLines((current) => {
      const targetIndex = index + delta;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(targetIndex, 0, row);
      return next;
    });
  };

  const handleCancel = () => {
    setForm(savedForm);
    setLines(savedLines);
    setEditing(false);
    setError("");
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
    const forkedFromLive = mustForkNewDraft(bundle?.version?.status);
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
        ingredients,
      });
      setSavedForm(form);
      setSavedLines(lines);
      setEditing(false);
      setActivationNote(forkedFromLive
        ? "Saved a new DRAFT. The ACTIVE version was not changed."
        : "Draft saved.");
      onSaved?.({ stayOpen: true, recipeId });
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
      onSaved?.({ stayOpen: true });
      await load();
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not link menu item."));
    } finally {
      setBusy("");
    }
  };

  const handleUploadFile = async (file) => {
    const recipeId = bundle?.recipe?.id || target?.recipeId || "new";
    const path = `food-bible/recipes/${recipeId}-${Date.now()}.jpg`;
    setBusy("image");
    try {
      const uploaded = await uploadMenuImage(file, path);
      if (uploaded?.error) throw uploaded.error;
      const nextPath = uploaded?.data?.path || path;
      setForm((current) => ({
        ...current,
        heroImagePath: nextPath,
        documentation: {
          ...current.documentation,
          gallery: [...(current.documentation?.gallery || []), { path: nextPath }],
          heroCrop: { x: 50, y: 50, zoom: 1, fit: "fill" },
        },
      }));
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not upload image."));
    } finally {
      setBusy("");
    }
  };

  const handleValidateActivation = async () => {
    const recipeId = bundle?.recipe?.id || target?.recipeId;
    if (!recipeId) {
      setActivationNote("Save the recipe before validating activation.");
      return;
    }
    setBusy("validate");
    setError("");
    setActivationNote("");
    try {
      const evaluation = await evaluateRecipeActivation(recipeId, {
        reason: activationReason,
        documentation: {
          ...form.documentation,
          operationalChange: {
            acknowledged: sourceAcknowledged,
            reason: activationReason,
          },
        },
      });
      setActivationBlockers(evaluation.blockers || []);
      setConversionNotes(evaluation.conversionNotes || []);
      setValidationDetailsOpen(false);
      if (evaluation.alreadyActive) setActivationNote("This version is already ACTIVE.");
      else if (evaluation.ok) setActivationNote("Validation passed. Safe to activate.");
      else setActivationNote("This recipe cannot be activated yet.");
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not validate recipe."));
    } finally {
      setBusy("");
    }
  };

  const handleActivate = async () => {
    const recipeId = bundle?.recipe?.id || target?.recipeId;
    if (!recipeId) {
      setActivationNote("Save the recipe before activating.");
      return;
    }
    if (!canActivate) {
      setActivationNote(needsSourceAck
        ? "Choose a change reason and acknowledge the source difference before activating."
        : "Choose an operational change reason before activating.");
      return;
    }
    setBusy("activate");
    setError("");
    try {
      await activateRecipeVersion(recipeId, {
        reason: activationReason,
        source: "food_bible",
        documentation: {
          ...form.documentation,
          operationalChange: {
            acknowledged: needsSourceAck ? sourceAcknowledged : true,
            reason: activationReason,
          },
        },
      });
      setActivationBlockers([]);
      setActivationNote("Activated. Previous active version was retired if one existed.");
      onSaved?.({ stayOpen: true, recipeId });
      await load();
    } catch (err) {
      setActivationBlockers(err.blockers || []);
      setError(friendlyRecipeError(err, "Activation blocked."));
    } finally {
      setBusy("");
    }
  };

  const handleCreateIngredient = async () => {
    const name = lineSearch.trim();
    if (!name) return;
    setBusy("ingredient");
    setError("");
    try {
      const created = await createIngredient({
        canonicalName: name,
        baseInventoryUnit: newIngredientUnit,
        branchId,
      });
      setCreatedIngredients((current) => [...current, created]);
      setLines((current) => {
        const blankIndex = current.findIndex((line) => !line.ingredientId && !line.subRecipeId);
        const nextLine = { ...emptyLine(), ingredientId: created.id, unit: newIngredientUnit };
        if (blankIndex >= 0) {
          return current.map((line, index) => (index === blankIndex ? { ...line, ingredientId: created.id, unit: newIngredientUnit } : line));
        }
        return [...current, nextLine];
      });
      setLineSearch("");
      onSaved?.({ stayOpen: true });
    } catch (err) {
      setError(friendlyRecipeError(err, "Could not create ingredient."));
    } finally {
      setBusy("");
    }
  };

  const updateCrop = (patch) => {
    setForm((current) => ({
      ...current,
      documentation: {
        ...current.documentation,
        heroCrop: { ...normalizeHeroCrop(current.documentation?.heroCrop), ...patch },
      },
    }));
  };

  const photo = heroUrl(form.heroImagePath);
  const doc = form.documentation || {};
  const unresolved = doc.unresolvedSourceLines || [];
  const searchNeedle = lineSearch.trim().toLowerCase();
  const searchMiss = Boolean(searchNeedle)
    && !ingredients.some((item) => item.active && String(item.canonicalName || "").toLowerCase().includes(searchNeedle))
    && !components.some((item) => String(item.name || "").toLowerCase().includes(searchNeedle));
  const kindLabel = form.recipeType === "preparation" || target?.kind === "component"
    ? "Prepared component"
    : target?.kind === "menu_item" || form.menuItemId
      ? "Linked live menu item"
      : "Source recipe";

  return (
    <div className="fb-card-overlay" data-testid="food-bible-card" data-editing={editing ? "true" : "false"}>
      <article className="fb-card">
        <header className="fb-card__toolbar">
          <div className="fb-card__toolbar-left">
            {onBack ? (
              <button type="button" onClick={onBack} data-testid="food-bible-card-back">
                <ChevronLeft size={18} /> Back
              </button>
            ) : null}
            <button type="button" onClick={onClose} aria-label="Close recipe" data-testid="food-bible-card-close">
              <X size={18} /> Close
            </button>
          </div>
          <div className="fb-card__toolbar-center">
            <p className="fb-card__kicker">NAC FOOD BIBLE</p>
            {breadcrumb.length > 1 ? (
              <p className="fb-card__crumb" data-testid="food-bible-card-breadcrumb">{breadcrumb.join(" > ")}</p>
            ) : null}
          </div>
          <div className="fb-card__toolbar-actions">
            {canEdit && !editing && !viewingHistorical ? (
              <button
                type="button"
                data-testid="food-bible-card-edit"
                onClick={() => {
                  setEditing(true);
                  if (mustForkNewDraft(bundle?.version?.status)) {
                    setActivationNote("Editing creates a new draft. Current active recipe stays live until you activate the new version.");
                  }
                }}
              >
                Edit
              </button>
            ) : null}
            {canEdit && editing ? (
              <>
                <button type="button" data-testid="food-bible-card-cancel" onClick={handleCancel}>Cancel</button>
                <button type="button" className="is-primary" data-testid="save-recipe-button" onClick={handleSave} disabled={Boolean(busy)}>
                  {busy === "save" ? "Saving…" : "Save Draft"}
                </button>
              </>
            ) : null}
          </div>
        </header>

        {error ? <p className="fb-card__error" data-testid="recipe-editor-error">{error}</p> : null}
        {loading ? (
          <div className="fb-card__loading"><Loader2 className="inv-spin" size={22} /> Loading card…</div>
        ) : null}

        {(!loading || bundle || !target?.recipeId) ? (
          <div className="fb-card__shell">
            <div className="fb-card__hero">
              <FoodBiblePhotoEditor
                photo={photo}
                crop={doc.heroCrop}
                editing={editing}
                busy={busy}
                onCropChange={updateCrop}
                onUploadFile={handleUploadFile}
                onRemove={() => setForm((current) => ({
                  ...current,
                  heroImagePath: "",
                  documentation: { ...current.documentation, heroCrop: null },
                }))}
                onReset={() => updateCrop({ x: 50, y: 50, zoom: 1, fit: "fill" })}
              />
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
                <p className="fb-card__kind" data-testid="food-bible-card-kind">{kindLabel}</p>
                <div className="fb-card__status-row">
                  <p
                    className={`inv-status-pill inv-status-pill--${String(bundle?.version?.status || "draft").toLowerCase()}`}
                    data-testid="food-bible-version-status"
                  >
                    Operational Recipe {versionStatus}
                  </p>
                  <p className="fb-card__status" data-testid="food-bible-recipe-completeness">
                    Recipe completeness: {completenessLabel(readiness.readiness)}
                  </p>
                  <p className="fb-card__status is-quiet" data-testid="food-bible-source-evidence">
                    Source reference: {sourcePdf}
                  </p>
                  {doc.sourceDataNeedsReview ? (
                    <p className="fb-card__review" data-testid="food-bible-source-review">Source review: needs review</p>
                  ) : null}
                  {needsSourceAck ? (
                    <p className="fb-card__review" data-testid="food-bible-source-modified">
                      Operationally modified from source
                    </p>
                  ) : null}
                </div>
                {sourceDiff.length ? (
                  <div className="fb-card__source-panel">
                    <button
                      type="button"
                      className="fb-card__source-toggle"
                      data-testid="food-bible-source-diff-toggle"
                      onClick={() => setSourceDiffOpen((open) => !open)}
                    >
                      {sourceDiffOpen ? "Hide changes" : "Tap to view changes"}
                    </button>
                    {sourceDiffOpen ? (
                      <ul className="fb-card__source-diff" data-testid="food-bible-source-diff">
                        {sourceDiff.map((row) => (
                          <li key={row.label}>{row.label}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                <div className="fb-card__version-panes" data-testid="food-bible-version-panes">
                  {[
                    { id: "current", label: "Current" },
                    { id: "drafts", label: "Drafts" },
                    { id: "history", label: "History" },
                  ].map((pane) => (
                    <button
                      key={pane.id}
                      type="button"
                      className={versionPane === pane.id ? "is-active" : ""}
                      data-testid={`food-bible-version-pane-${pane.id}`}
                      onClick={() => {
                        setVersionPane(pane.id);
                        if (pane.id === "current" && bundle?.version?.id) {
                          setViewedVersionId(bundle.version.id);
                          setLines(savedLines.length ? savedLines : lines);
                        }
                      }}
                    >
                      {pane.label}
                    </button>
                  ))}
                </div>
                {versionPane === "drafts" ? (
                  <ul className="fb-card__version-list" data-testid="food-bible-drafts-list">
                    {draftVersions.length ? draftVersions.map((version) => (
                      <li key={version.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (editing) return;
                            setViewedVersionId(version.id);
                            const histLines = (bundle?.allLines || []).filter((line) => line.recipeVersionId === version.id);
                            setLines(histLines.length ? histLines : [emptyLine()]);
                          }}
                        >
                          Draft v{version.versionNumber || "—"}
                        </button>
                      </li>
                    )) : <li>No drafts</li>}
                  </ul>
                ) : null}
                {versionPane === "history" ? (
                  <ul className="fb-card__version-list" data-testid="food-bible-history-list">
                    {historyVersions.length ? historyVersions.map((version) => (
                      <li key={version.id}>
                        <p>Active from {formatVersionWhen(version.effectiveFrom)}</p>
                        <p>Active until {formatVersionWhen(version.effectiveTo)}</p>
                        <p>Change reason {versionReasonLabel(version)}</p>
                        <p>Who activated it {version.approvedBy ? "Recorded" : "—"}</p>
                      </li>
                    )) : <li>No previous versions</li>}
                  </ul>
                ) : null}
                {canEdit && bundle?.recipe?.id && !viewingHistorical ? (
                  <div className="fb-card__activation-actions" data-testid="food-bible-activate-panel">
                    <p className="fb-card__activate-title">Activate Recipe</p>
                    <label className="fb-card__reason">
                      <span>Reason</span>
                      <select
                        data-testid="food-bible-activation-reason"
                        value={activationReason}
                        onChange={(event) => setActivationReason(event.target.value)}
                        disabled={Boolean(busy) || editing}
                      >
                        <option value="">Select reason</option>
                        {OPERATIONAL_CHANGE_REASONS.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </label>
                    {needsSourceAck ? (
                      <label className="fb-card__ack">
                        <input
                          type="checkbox"
                          data-testid="food-bible-source-ack"
                          checked={sourceAcknowledged}
                          onChange={(event) => setSourceAcknowledged(event.target.checked)}
                          disabled={Boolean(busy) || editing}
                        />
                        I confirm this is the recipe currently used in the kitchen
                      </label>
                    ) : null}
                    <button
                      type="button"
                      data-testid="food-bible-validate-button"
                      onClick={handleValidateActivation}
                      disabled={Boolean(busy) || editing}
                    >
                      {busy === "validate" ? "Validating…" : "Validate"}
                    </button>
                    {versionStatus === "DRAFT" ? (
                      <button
                        type="button"
                        className="is-primary"
                        data-testid="food-bible-activate-button"
                        onClick={handleActivate}
                        disabled={Boolean(busy) || editing || !canActivate}
                      >
                        {busy === "activate" ? "Activating…" : "Activate"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {activationNote ? <p className="fb-card__status" data-testid="food-bible-activation-note">{activationNote}</p> : null}
                {conversionNotes.length ? (
                  <ul className="fb-card__conversion-notes" data-testid="food-bible-conversion-notes">
                    {conversionNotes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                ) : null}
                {activationBlockers.length ? (
                  <div className="fb-card__validation">
                    <ul className="fb-card__activation-blockers" data-testid="food-bible-activation-blockers">
                      {activationBlockers
                        .map((item, index) => ({ item, index, message: formatStaffValidationMessage(item) }))
                        .filter(({ item, message }) => message && message !== item.code)
                        .map(({ item, index, message }) => (
                          <li key={`${item.code || "block"}-${index}`}>{message}</li>
                        ))}
                    </ul>
                    <button
                      type="button"
                      className="fb-card__details-toggle"
                      data-testid="food-bible-validation-details"
                      onClick={() => setValidationDetailsOpen((open) => !open)}
                    >
                      {validationDetailsOpen ? "Hide details" : "Details"}
                    </button>
                    {validationDetailsOpen ? (
                      <ul className="fb-card__validation-codes" data-testid="food-bible-validation-codes">
                        {activationBlockers.map((item, index) => (
                          <li key={`${item.code || "code"}-${index}`}>{item.code}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {target?.linkKind === "inferred" ? <p className="fb-card__review">Needs menu confirmation</p> : null}
                <p className="fb-card__link">
                  {form.menuItemId ? `Linked live menu item: ${linkedName || "Linked"}` : "Not linked to a live menu item"}
                  {canEdit ? (
                    <button type="button" data-testid="food-bible-link-menu-button" onClick={() => setLinkOpen(true)}>
                      Link to menu item
                    </button>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="fb-card__segments" role="tablist" aria-label="Recipe workspace">
              {WORKSPACES.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={workspace === tab.id}
                  className={workspace === tab.id ? "is-active" : ""}
                  data-testid={`food-bible-workspace-${tab.id}`}
                  onClick={() => setWorkspace(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="fb-card__workspace" data-testid="food-bible-workspace-pane" data-workspace={workspace}>
              {workspace === "ingredients" ? (
                <section className="fb-card__table-wrap">
                  <div className="fb-card__table-head">
                    <h3>Ingredients</h3>
                    {editing ? (
                      <input
                        value={lineSearch}
                        onChange={(event) => setLineSearch(event.target.value)}
                        placeholder="Search to add"
                        data-testid="recipe-ingredient-search"
                      />
                    ) : null}
                  </div>
                  {editing && searchMiss ? (
                    <div className="fb-card__new-ingredient" data-testid="food-bible-new-ingredient">
                      <p>No match for “{lineSearch.trim()}”. Create it here — supplier and cost can wait.</p>
                      <label>
                        <span>Name</span>
                        <input
                          data-testid="food-bible-new-ingredient-name"
                          value={lineSearch}
                          onChange={(event) => setLineSearch(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>Base UOM</span>
                        <select
                          data-testid="food-bible-new-ingredient-unit"
                          value={newIngredientUnit}
                          onChange={(event) => setNewIngredientUnit(event.target.value)}
                        >
                          {CANONICAL_UNITS.map((unit) => (
                            <option key={unit.value} value={unit.value}>{recipeUnitShort(unit.value)} · {unitLabel(unit.value)}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        data-testid="food-bible-create-ingredient-button"
                        onClick={handleCreateIngredient}
                        disabled={Boolean(busy)}
                      >
                        {busy === "ingredient" ? "Creating…" : "Create + Add"}
                      </button>
                    </div>
                  ) : null}
                  <table className="fb-card__table">
                    <thead>
                      <tr>
                        <th>Ingredient</th>
                        <th>Qty</th>
                        <th>UOM</th>
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
                        const lineKind = classifyRecipeLineKind(line, { ingredientName: label });
                        const documentation = lineKind === RECIPE_LINE_KIND.DOCUMENTATION_LINE;
                        const subrecipeLine = Boolean(line.subRecipeId || line.lineKind === "subrecipe");
                        const filterChoices = !(line.ingredientId || line.subRecipeId);
                        return (
                          <tr
                            key={key}
                            data-testid={`recipe-line-${index}`}
                            className={[component || subrecipeLine ? "is-component" : "", documentation ? "is-documentation" : ""].filter(Boolean).join(" ")}
                          >
                            <td>
                              {editing ? (
                                <select
                                  data-testid={`recipe-line-item-${index}`}
                                  value={line.subRecipeId ? `cmp:${line.subRecipeId}` : line.ingredientId ? `ing:${line.ingredientId}` : ""}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    if (value.startsWith("cmp:")) updateLine(key, { subRecipeId: value.slice(4), ingredientId: "", lineKind: "subrecipe" });
                                    else updateLine(key, { ingredientId: value.replace(/^ing:/, ""), subRecipeId: "", lineKind: "ingredient" });
                                  }}
                                >
                                  <option value="">{subrecipeLine ? "Select sub-recipe" : "Select ingredient"}</option>
                                  {subrecipeLine
                                    ? components
                                      .filter((item) => !filterChoices || !lineSearch || item.name.toLowerCase().includes(lineSearch.toLowerCase()))
                                      .map((item) => (
                                        <option key={item.id} value={`cmp:${item.id}`}>{item.name}</option>
                                      ))
                                    : ingredients
                                      .filter((item) => item.active && (!filterChoices || !lineSearch || item.canonicalName.toLowerCase().includes(lineSearch.toLowerCase())))
                                      .map((item) => (
                                        <option key={item.id} value={`ing:${item.id}`}>{item.canonicalName}</option>
                                      ))}
                                </select>
                              ) : component ? (
                                <button
                                  type="button"
                                  className="fb-card__component"
                                  data-testid={`open-component-${component.id}`}
                                  onClick={() => onOpenRecipe?.(componentOpenTarget(target, component))}
                                >
                                  {label}
                                </button>
                              ) : <>{label}{documentation ? <small> Note</small> : null}</>}
                              {warning ? <small>Duplicate line — add a distinguishing note</small> : null}
                            </td>
                            <td>
                              {editing ? (
                                <input inputMode="decimal" data-testid={`recipe-line-qty-${index}`} value={line.quantity} onChange={(event) => updateLine(key, { quantity: event.target.value })} />
                              ) : line.quantity}
                            </td>
                            <td>
                              {editing ? (
                                <select data-testid={`recipe-line-unit-${index}`} value={line.unit} onChange={(event) => updateLine(key, { unit: event.target.value })}>
                                  {CANONICAL_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{recipeUnitShort(unit.value)}</option>)}
                                </select>
                              ) : recipeUnitShort(line.unit)}
                            </td>
                            {editing ? (
                              <td className="fb-card__line-actions">
                                <button type="button" aria-label="Move line up" data-testid={`move-recipe-line-up-${index}`} onClick={() => moveLine(index, -1)} disabled={index === 0}>
                                  <ChevronUp size={14} />
                                </button>
                                <button type="button" aria-label="Move line down" data-testid={`move-recipe-line-down-${index}`} onClick={() => moveLine(index, 1)} disabled={index === lines.length - 1}>
                                  <ChevronDown size={14} />
                                </button>
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
                    <div className="fb-card__add-actions">
                      <button type="button" data-testid="add-recipe-line-button" onClick={() => { setLines((current) => [...current, emptyLine("ingredient")]); setLineSearch(""); }}>
                        <Plus size={14} /> Add ingredient
                      </button>
                      <button type="button" data-testid="add-subrecipe-line-button" onClick={() => { setLines((current) => [...current, emptyLine("subrecipe")]); setLineSearch(""); }}>
                        <Plus size={14} /> Add sub-recipe
                      </button>
                    </div>
                  ) : null}
                  {!editing && unresolved.length ? (
                    <table className="fb-card__table">
                      <tbody>
                        {unresolved.map((row) => (
                          <tr key={row.sourceName} data-testid="food-bible-unresolved-line">
                            <td>{row.sourceName}</td>
                            <td>—</td>
                            <td>—</td>
                            <td>Needs review — quantity not captured in source</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {!editing && !lines.some((line) => line.ingredientId || line.subRecipeId) && !unresolved.length ? (
                    <p data-testid="food-bible-no-ingredients">No ingredients recorded</p>
                  ) : null}
                </section>
              ) : null}

              {workspace === "method" ? (
                <section className="fb-card__method">
                  <h3>Method</h3>
                  {editing ? (
                    <textarea
                      data-testid="recipe-method-input"
                      className="fb-card__method-editor"
                      value={doc.preparationMethod || ""}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        documentation: { ...current.documentation, preparationMethod: event.target.value },
                      }))}
                    />
                  ) : (
                    <pre>{doc.preparationMethod || "No method recorded"}</pre>
                  )}
                  <h3>To serve / plating</h3>
                  {editing ? (
                    <textarea
                      data-testid="recipe-plating-input"
                      className="fb-card__method-editor"
                      value={doc.platingInstructions || ""}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        documentation: { ...current.documentation, platingInstructions: event.target.value },
                      }))}
                    />
                  ) : (
                    <pre>{doc.platingInstructions || "—"}</pre>
                  )}
                </section>
              ) : null}

              {workspace === "details" ? (
                <section className="fb-card__details" data-testid="food-bible-details">
                  <label>Yield
                    {editing ? (
                      <span className="fb-card__yield-edit">
                        <input data-testid="recipe-yield-quantity-input" value={form.outputQuantity} onChange={(event) => setForm((current) => ({ ...current, outputQuantity: event.target.value }))} />
                        <select value={form.outputUnit} onChange={(event) => setForm((current) => ({ ...current, outputUnit: event.target.value }))}>
                          {CANONICAL_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unitLabel(unit.value)}</option>)}
                        </select>
                      </span>
                    ) : <span>{form.outputQuantity || "—"} {form.outputUnit || ""}</span>}
                  </label>
                  <label>Prep time
                    {editing ? (
                      <input value={doc.prepTime || ""} onChange={(event) => setForm((current) => ({ ...current, documentation: { ...current.documentation, prepTime: event.target.value } }))} />
                    ) : <span>{doc.prepTime || "—"}</span>}
                  </label>
                  <label>Cook time
                    {editing ? (
                      <input value={doc.cookTime || ""} onChange={(event) => setForm((current) => ({ ...current, documentation: { ...current.documentation, cookTime: event.target.value } }))} />
                    ) : <span>{doc.cookTime || "—"}</span>}
                  </label>
                  <label>Utensils
                    {editing ? (
                      <input value={doc.utensils || ""} onChange={(event) => setForm((current) => ({ ...current, documentation: { ...current.documentation, utensils: event.target.value } }))} />
                    ) : <span>{doc.utensils || doc.equipmentNotes || "—"}</span>}
                  </label>
                  <label>Allergens
                    {editing ? (
                      <input value={doc.allergens || ""} onChange={(event) => setForm((current) => ({ ...current, documentation: { ...current.documentation, allergens: event.target.value } }))} />
                    ) : <span>{doc.allergens || "—"}</span>}
                  </label>
                  <label>Source section
                    {editing ? (
                      <input value={doc.menuSection || ""} onChange={(event) => setForm((current) => ({ ...current, documentation: { ...current.documentation, menuSection: event.target.value } }))} />
                    ) : <span>{doc.menuSection || "—"}</span>}
                  </label>
                  <label>Live availability
                    <span>{target?.placementSummary || "—"}</span>
                  </label>
                </section>
              ) : null}
            </div>
          </div>
        ) : null}
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
