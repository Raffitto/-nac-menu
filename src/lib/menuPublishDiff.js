import { isHiddenFromPublicMenu, parseHiddenUntil } from "./menuVisibility";

/** Guest-visible item fields used for publish intelligence. */
export const GUEST_ITEM_FIELDS = [
  "name_en",
  "name_ar",
  "desc_en",
  "desc_ar",
  "price",
  "calories",
  "image",
  "sold_out",
  "active",
  "hidden_until",
  "featured",
  "new_item",
  "vegetarian",
  "vegan",
  "section_id",
  "category_id",
  "sort_order",
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normStr(value) {
  if (value == null) return "";
  return String(value);
}

function normBool(value) {
  return Boolean(value);
}

function comparableItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    name_en: normStr(item.name_en),
    name_ar: normStr(item.name_ar),
    desc_en: normStr(item.desc_en),
    desc_ar: normStr(item.desc_ar),
    price: item.price == null || item.price === "" ? null : Number(item.price),
    calories: item.calories == null || item.calories === "" ? null : Number(item.calories),
    image: normStr(item.image),
    sold_out: normBool(item.sold_out),
    active: item.active !== false,
    hidden_until: item.hidden_until || null,
    featured: normBool(item.featured),
    new_item: normBool(item.new_item),
    vegetarian: normBool(item.vegetarian),
    vegan: normBool(item.vegan),
    section_id: item.section_id || null,
    category_id: item.category_id || null,
    sort_order: Number(item.sort_order) || 0,
    branch_id: item.branch_id || null,
  };
}

function indexById(rows) {
  const map = new Map();
  asArray(rows).forEach((row) => {
    if (row?.id != null) map.set(row.id, row);
  });
  return map;
}

function junctionKey(row, left, right) {
  return `${row?.[left]}::${row?.[right]}`;
}

function indexJunctions(rows, left, right) {
  const map = new Map();
  asArray(rows).forEach((row) => {
    map.set(junctionKey(row, left, right), row);
  });
  return map;
}

function fieldChanges(before, after, fields) {
  const changes = [];
  fields.forEach((field) => {
    const left = before?.[field];
    const right = after?.[field];
    const same =
      field === "price" || field === "calories" || field === "sort_order"
        ? Number(left) === Number(right) || (left == null && right == null)
        : field === "sold_out" ||
            field === "active" ||
            field === "featured" ||
            field === "new_item" ||
            field === "vegetarian" ||
            field === "vegan"
          ? Boolean(left) === Boolean(right)
          : normStr(left) === normStr(right);
    if (!same) {
      changes.push({ field, from: left ?? null, to: right ?? null });
    }
  });
  return changes;
}

function visibilityLabel(item, nowMs = Date.now()) {
  if (!item) return "Missing";
  if (item.active === false) return "Hidden";
  const until = parseHiddenUntil(item);
  if (until != null && until > nowMs) {
    return `Scheduled until ${new Date(until).toLocaleString("en-GB", {
      timeZone: "Asia/Riyadh",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  if (isHiddenFromPublicMenu(item, nowMs)) return "Hidden";
  return "Visible";
}

function sectionLabel(sectionsById, sectionId) {
  const section = sectionsById.get(sectionId);
  return section?.name_en || sectionId || "Unknown section";
}

function categoryLabel(categoriesById, categoryId) {
  const category = categoriesById.get(categoryId);
  return category?.name_en || categoryId || "Unknown category";
}

function classifyChange(entry) {
  if (entry.kind === "added") return "new";
  if (entry.kind === "removed") return "removed";
  const fields = new Set((entry.fieldChanges || []).map((c) => c.field));
  if (fields.has("section_id") || fields.has("category_id")) return "moved";
  if (fields.has("price")) return "price";
  if (fields.has("image")) return "image";
  if (fields.has("active") || fields.has("hidden_until")) return "availability";
  if (fields.has("sold_out")) return "sold_out";
  if (fields.has("sort_order") && fields.size === 1) return "reorder";
  if (fields.has("name_en") || fields.has("name_ar") || fields.has("desc_en") || fields.has("desc_ar")) {
    return "copy";
  }
  if (fields.has("calories")) return "calories";
  return "updated";
}

function humanizeEntry(entry, ctx) {
  const name = entry.name_en || "Item";
  const lines = [];
  if (entry.kind === "added") {
    lines.push(`Added to ${entry.toSectionName || "menu"}`);
  } else if (entry.kind === "removed") {
    lines.push(`Removed from ${entry.fromSectionName || "menu"}`);
  } else {
    (entry.fieldChanges || []).forEach((change) => {
      if (change.field === "price") {
        lines.push(`Price: ${change.from ?? "—"} SAR → ${change.to ?? "—"} SAR`);
      } else if (change.field === "calories") {
        lines.push(`Calories: ${change.from ?? "—"} → ${change.to ?? "—"}`);
      } else if (change.field === "section_id") {
        lines.push(
          `Moved: ${sectionLabel(ctx.liveSections, change.from)} → ${sectionLabel(ctx.draftSections, change.to)}`,
        );
      } else if (change.field === "category_id") {
        lines.push(
          `Category: ${categoryLabel(ctx.liveCategories, change.from)} → ${categoryLabel(ctx.draftCategories, change.to)}`,
        );
      } else if (change.field === "active" || change.field === "hidden_until") {
        lines.push(
          `Visibility: ${visibilityLabel(entry.before, ctx.nowMs)} → ${visibilityLabel(entry.after, ctx.nowMs)}`,
        );
      } else if (change.field === "sold_out") {
        lines.push(`Status: ${change.from ? "Sold out" : "Available"} → ${change.to ? "Sold out" : "Available"}`);
      } else if (change.field === "image") {
        lines.push(change.to ? "Image changed" : "Image removed");
      } else if (change.field === "sort_order") {
        // handled in semantic reorder summary
      } else if (change.field === "name_en") {
        lines.push(`Name: ${change.from || "—"} → ${change.to || "—"}`);
      } else if (change.field === "desc_en") {
        lines.push("Description updated");
      }
    });
  }

  if (entry.placementLines?.length) {
    entry.placementLines.forEach((line) => lines.push(line));
  }

  return {
    ...entry,
    category: classifyChange(entry),
    summaryLines: lines.filter(Boolean),
    title: name,
  };
}

function buildReorderSummaries(itemEntries, liveSections, draftSections) {
  const bySection = new Map();
  itemEntries.forEach((entry) => {
    if (entry.kind !== "updated") return;
    const onlyOrder =
      (entry.fieldChanges || []).length > 0 &&
      (entry.fieldChanges || []).every((c) => c.field === "sort_order");
    const sectionId = entry.after?.section_id;
    if (!onlyOrder || !sectionId) return;
    if (!bySection.has(sectionId)) bySection.set(sectionId, []);
    bySection.get(sectionId).push(entry);
  });

  const summaries = [];
  bySection.forEach((entries, sectionId) => {
    const sectionName = sectionLabel(draftSections, sectionId);
    const liveItems = asArray(
      [...liveSections.values()].find((s) => s.id === sectionId)
        ? null
        : null,
    );
    void liveItems;
    if (entries.length >= 3) {
      summaries.push({
        id: `reorder-${sectionId}`,
        kind: "reorder_summary",
        category: "reorder",
        title: sectionName,
        summaryLines: [`Reordered ${entries.length} items in ${sectionName}`],
        itemIds: entries.map((e) => e.id),
      });
    } else {
      entries.forEach((entry) => {
        const draftSectionItems = asArray(
          // filled by caller via draft item order if needed
        );
        void draftSectionItems;
        summaries.push({
          id: `reorder-item-${entry.id}`,
          kind: "reorder",
          category: "reorder",
          title: entry.name_en || "Item",
          summaryLines: [`Position changed within ${sectionName}`],
          itemIds: [entry.id],
        });
      });
    }
  });
  return summaries;
}

/**
 * Diff two publication-shaped snapshots.
 * @param {object} liveSnapshot last verified publication.snapshot
 * @param {object} draftSnapshot current branch snapshot
 */
export function diffMenuSnapshots(liveSnapshot, draftSnapshot, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const live = liveSnapshot || {};
  const draft = draftSnapshot || {};

  const liveCategories = indexById(live.categories);
  const draftCategories = indexById(draft.categories);
  const liveSections = indexById(live.sections);
  const draftSections = indexById(draft.sections);
  const liveItems = indexById(asArray(live.menu_items).map(comparableItem));
  const draftItems = indexById(asArray(draft.menu_items).map(comparableItem));

  const liveAllergens = indexJunctions(live.item_allergens, "item_id", "allergen_id");
  const draftAllergens = indexJunctions(draft.item_allergens, "item_id", "allergen_id");

  const itemEntries = [];
  const changedItemIds = new Set();
  const newItemIds = new Set();
  const removedItemIds = new Set();
  const changesBySectionId = new Map();
  const changesByCategoryId = new Map();

  const bumpCount = (map, key) => {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  };

  const allIds = new Set([...liveItems.keys(), ...draftItems.keys()]);
  allIds.forEach((id) => {
    const before = liveItems.get(id) || null;
    const after = draftItems.get(id) || null;
    if (!before && after) {
      const entry = {
        id,
        kind: "added",
        name_en: after.name_en,
        before: null,
        after,
        fieldChanges: [],
        toSectionName: sectionLabel(draftSections, after.section_id),
        toCategoryId: after.category_id,
        toSectionId: after.section_id,
      };
      itemEntries.push(entry);
      newItemIds.add(id);
      bumpCount(changesBySectionId, after.section_id);
      bumpCount(changesByCategoryId, after.category_id);
      return;
    }
    if (before && !after) {
      const entry = {
        id,
        kind: "removed",
        name_en: before.name_en,
        before,
        after: null,
        fieldChanges: [],
        fromSectionName: sectionLabel(liveSections, before.section_id),
        fromCategoryId: before.category_id,
        fromSectionId: before.section_id,
      };
      itemEntries.push(entry);
      removedItemIds.add(id);
      bumpCount(changesBySectionId, before.section_id);
      bumpCount(changesByCategoryId, before.category_id);
      return;
    }

    const fields = fieldChanges(before, after, GUEST_ITEM_FIELDS.filter((f) => f !== "sort_order"));
    const orderChanged = Number(before.sort_order) !== Number(after.sort_order);
    const allergenBefore = [...liveAllergens.keys()].filter((k) => k.startsWith(`${id}::`)).sort();
    const allergenAfter = [...draftAllergens.keys()].filter((k) => k.startsWith(`${id}::`)).sort();
    const allergensChanged = JSON.stringify(allergenBefore) !== JSON.stringify(allergenAfter);

    if (!fields.length && !orderChanged && !allergensChanged) return;

    const fieldChangesFull = [...fields];
    if (orderChanged) {
      fieldChangesFull.push({
        field: "sort_order",
        from: before.sort_order,
        to: after.sort_order,
      });
    }
    if (allergensChanged) {
      fieldChangesFull.push({
        field: "allergens",
        from: allergenBefore.length,
        to: allergenAfter.length,
      });
    }

    const entry = {
      id,
      kind: "updated",
      name_en: after.name_en || before.name_en,
      before,
      after,
      fieldChanges: fieldChangesFull,
      fromSectionName: sectionLabel(liveSections, before.section_id),
      toSectionName: sectionLabel(draftSections, after.section_id),
      fromCategoryId: before.category_id,
      toCategoryId: after.category_id,
      fromSectionId: before.section_id,
      toSectionId: after.section_id,
    };

    // Multi-placement awareness: same name group across categories
    if (before.category_id !== after.category_id || before.section_id !== after.section_id) {
      entry.placementLines = [
        `${categoryLabel(draftCategories, after.category_id)}: ${sectionLabel(liveSections, before.section_id)} → ${sectionLabel(draftSections, after.section_id)}`,
      ];
    }

    itemEntries.push(entry);
    changedItemIds.add(id);
    bumpCount(changesBySectionId, after.section_id || before.section_id);
    bumpCount(changesByCategoryId, after.category_id || before.category_id);
  });

  const ctx = {
    liveSections,
    draftSections,
    liveCategories,
    draftCategories,
    nowMs,
  };

  const detailed = itemEntries.map((entry) => humanizeEntry(entry, ctx));
  const reorderOnlyIds = new Set(
    detailed
      .filter((e) => e.category === "reorder")
      .map((e) => e.id),
  );
  const reorderSummaries = buildReorderSummaries(
    detailed.filter((e) => reorderOnlyIds.has(e.id)),
    liveSections,
    draftSections,
  );

  const nonReorder = detailed.filter((e) => e.category !== "reorder");
  const changes = [...nonReorder, ...reorderSummaries];

  const counts = {
    total: changes.length,
    new: changes.filter((c) => c.category === "new").length,
    removed: changes.filter((c) => c.category === "removed").length,
    moved: changes.filter((c) => c.category === "moved").length,
    price: changes.filter((c) => c.category === "price").length,
    availability: changes.filter((c) => c.category === "availability").length,
    sold_out: changes.filter((c) => c.category === "sold_out").length,
    image: changes.filter((c) => c.category === "image").length,
    reorder: changes.filter((c) => c.category === "reorder" || c.kind === "reorder_summary").length,
    copy: changes.filter((c) => c.category === "copy").length,
    calories: changes.filter((c) => c.category === "calories").length,
    updated: changes.filter((c) => c.category === "updated").length,
  };

  const risk = {
    largeBatch: counts.total >= 25,
    manyPrices: counts.price >= 10,
    manyHidden: counts.availability >= 10,
  };

  return {
    counts,
    changes,
    changedItemIds: [...changedItemIds],
    newItemIds: [...newItemIds],
    removedItemIds: [...removedItemIds],
    changesBySectionId: Object.fromEntries(changesBySectionId),
    changesByCategoryId: Object.fromEntries(changesByCategoryId),
    risk,
    hasChanges: counts.total > 0,
  };
}

export function itemPublishBadge(itemId, diff) {
  if (!diff) return null;
  if (diff.newItemIds?.includes(itemId)) return { key: "new", label: "New" };
  if (diff.changedItemIds?.includes(itemId)) return { key: "changed", label: "Changed" };
  return null;
}

export function summarizeDiffForPublish(diff) {
  if (!diff?.hasChanges) {
    return {
      headline: "No unpublished guest-facing changes",
      bullets: [],
      risk: diff?.risk || {},
    };
  }
  const c = diff.counts;
  const bullets = [];
  if (c.moved) bullets.push(`${c.moved} moved`);
  if (c.price) bullets.push(`${c.price} price change${c.price === 1 ? "" : "s"}`);
  if (c.availability) bullets.push(`${c.availability} availability change${c.availability === 1 ? "" : "s"}`);
  if (c.sold_out) bullets.push(`${c.sold_out} sold-out change${c.sold_out === 1 ? "" : "s"}`);
  if (c.image) bullets.push(`${c.image} image change${c.image === 1 ? "" : "s"}`);
  if (c.new) bullets.push(`${c.new} new item${c.new === 1 ? "" : "s"}`);
  if (c.removed) bullets.push(`${c.removed} removed`);
  if (c.reorder) bullets.push(`${c.reorder} reorder update${c.reorder === 1 ? "" : "s"}`);
  if (c.copy) bullets.push(`${c.copy} copy update${c.copy === 1 ? "" : "s"}`);
  if (c.calories) bullets.push(`${c.calories} calorie update${c.calories === 1 ? "" : "s"}`);
  if (c.updated) bullets.push(`${c.updated} other update${c.updated === 1 ? "" : "s"}`);

  return {
    headline: `${c.total} change${c.total === 1 ? "" : "s"} ready to publish`,
    bullets,
    risk: diff.risk,
  };
}
