import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Plus,
  Edit3,
  Trash2,
  Copy,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Image as ImageIcon,
  Upload,
  Check,
  AlertCircle,
  Eye,
  Ban,
  Loader2,
  UtensilsCrossed,
  Package,
  LayoutGrid,
} from "lucide-react";
import {
  getCategories,
  
  createMenuItemPlacements,
  updateMenuItemPlacements,
  fetchPlacementGroupMembers,
  fetchPlacementGroupIndex,
  deleteMenuItem,
  toggleSoldOut,
  applyMenuItemVisibility,
  assertMenuMutation,
  sanitizeMenuItemPayload,
  fetchMenuItemById,
  reorderSections,
  reorderItems,
  createCategory,
  updateCategory,
  deleteCategory,
  createSection,
  updateSection,
  deleteSection,
  getAddOns,
  createAddOn,
  updateAddOn,
  deleteAddOn,
  getAllergens,
  uploadMenuImage,
  deleteMenuImage,
  duplicateMenuItem,
} from "../lib/menuApi";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  computeHiddenUntilIso,
  getItemVisibilityBadge,
  isHiddenFromPublicMenu,
  parseHiddenUntil,
} from "../lib/menuVisibility";
import {
  validatePlacements,
  formatLinkedPlacementBadge,
  buildPlacementGroupSummary,
} from "../lib/menuPlacements";
import { useRbac } from "./context/RbacContext";
import {
  resolveMenuEditorBranch,
  canEditMenuEngineering,
  assertMenuBranchAccess,
} from "../lib/menuBranchScope";
import { branchDisplayOptions } from "./config/branchDisplayConfig";
import "./styles/menu-manager.css";

function toDatetimeLocalValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resolveVisibilityPatch(form) {
  const patch = { sold_out: Boolean(form.soldOut) };
  if (form.mode === "active") {
    patch.active = true;
    patch.hidden_until = null;
  } else if (form.mode === "indefinite") {
    patch.active = false;
    patch.hidden_until = null;
  } else {
    const hiddenUntil = computeHiddenUntilIso({
      mode: form.mode,
      hours: form.hours,
      dateTimeLocal: form.dateTime,
    });
    if (!hiddenUntil) {
      throw new Error("Enter a valid future reopen time");
    }
    patch.active = true;
    patch.hidden_until = hiddenUntil;
  }
  return patch;
}

const EMPTY_ITEM = {
  name_en: "",
  name_ar: "",
  desc_en: "",
  desc_ar: "",
  price: "",
  calories: "",
  image: "",
  category_id: "",
  section_id: "",
  sold_out: false,
  featured: false,
  new_item: false,
  vegetarian: false,
  vegan: false,
  active: true,
  hidden_until: null,
};

const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "sold_out", label: "Sold Out" },
  { key: "inactive", label: "Inactive" },
  { key: "vegetarian", label: "Vegetarian" },
  { key: "new_item", label: "New" },
];

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <motion.div
      className={`mm-toast ${type}`}
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
    >
      {type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
      {message}
    </motion.div>
  );
}

function ConfirmDialog({ title, message, onConfirm, onCancel, loading }) {
  return (
    <motion.div
      className="mm-confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="mm-confirm-dialog"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h4>{title}</h4>
        <p>{message}</p>
        <div className="mm-confirm-actions">
          <button className="mm-btn mm-btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="mm-btn mm-btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 size={14} className="mm-spin-icon" /> : null}
            Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ToggleSwitch({ value, onChange }) {
  return (
    <button
      type="button"
      className={`mm-toggle-switch ${value ? "on" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span className="mm-toggle-switch-dot" />
    </button>
  );
}

function ItemVisibilityModal({
  item,
  form,
  setForm,
  onConfirm,
  onCancel,
  loading,
}) {
  return (
    <motion.div
      className="mm-confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="mm-confirm-dialog mm-hide-dialog"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h4>Guest menu visibility</h4>
        <p className="mm-hide-dialog-sub">
          {item?.name_en} — applies everywhere on the customer menu (Desserts, Evening desserts, etc.).
        </p>
        <div className="mm-hide-options">
          <label className={`mm-hide-option ${form.mode === "active" ? "selected" : ""}`}>
            <input
              type="radio"
              name="visMode"
              checked={form.mode === "active"}
              onChange={() => setForm((f) => ({ ...f, mode: "active" }))}
            />
            <span>Active — visible on guest menu</span>
          </label>
          <label className={`mm-hide-option ${form.mode === "indefinite" ? "selected" : ""}`}>
            <input
              type="radio"
              name="visMode"
              checked={form.mode === "indefinite"}
              onChange={() => setForm((f) => ({ ...f, mode: "indefinite" }))}
            />
            <span>Hidden until manually restored</span>
          </label>
          <label className={`mm-hide-option ${form.mode === "hours" ? "selected" : ""}`}>
            <input
              type="radio"
              name="visMode"
              checked={form.mode === "hours"}
              onChange={() => setForm((f) => ({ ...f, mode: "hours" }))}
            />
            <span>Hide — reopen automatically after</span>
            <input
              type="number"
              className="mm-hide-hours-input"
              min={1}
              max={168}
              value={form.hours}
              onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
              disabled={form.mode !== "hours"}
            />
            <span>hours</span>
          </label>
          <label className={`mm-hide-option ${form.mode === "datetime" ? "selected" : ""}`}>
            <input
              type="radio"
              name="visMode"
              checked={form.mode === "datetime"}
              onChange={() => setForm((f) => ({ ...f, mode: "datetime" }))}
            />
            <span>Hide until date & time</span>
            <input
              type="datetime-local"
              className="mm-hide-datetime-input"
              value={form.dateTime}
              onChange={(e) => setForm((f) => ({ ...f, dateTime: e.target.value }))}
              disabled={form.mode !== "datetime"}
            />
          </label>
        </div>
        <div className="mm-visibility-sold-out-row">
          <span className="mm-toggle-label">Sold out (visible but unavailable)</span>
          <ToggleSwitch
            value={form.soldOut}
            onChange={(v) => setForm((f) => ({ ...f, soldOut: v }))}
          />
        </div>
        <div className="mm-confirm-actions">
          <button className="mm-btn mm-btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="mm-btn mm-btn-primary" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader2 size={14} className="mm-spin-icon" /> : null}
            Save visibility
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function MenuManager() {
  const rbac = useRbac();
  const readOnlyMenu = !canEditMenuEngineering(rbac.profile);
  const menuBranchOptions = useMemo(
    () =>
      rbac.canAccessAllBranches()
        ? branchDisplayOptions("dashboardName")
        : branchDisplayOptions("dashboardName").filter((o) => o.value === rbac.profile.branchScope),
    [rbac],
  );
  const [menuBranch, setMenuBranch] = useState(() => resolveMenuEditorBranch(rbac.profile, null));
  const [activeTab, setActiveTab] = useState("menu");
  const [categories, setCategories] = useState([]);
  const [selectedCatId, setSelectedCatId] = useState(null);
  const [menuData, setMenuData] = useState([]);
  const [addOns, setAddOns] = useState([]);
  const [allergens, setAllergens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedSections, setExpandedSections] = useState({});
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [visibilityTarget, setVisibilityTarget] = useState(null);
  const [visibilityForm, setVisibilityForm] = useState({
    mode: "active",
    hours: "2",
    dateTime: "",
    soldOut: false,
  });
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create");
  const [editingItem, setEditingItem] = useState({ ...EMPTY_ITEM });
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemAllergenIds, setItemAllergenIds] = useState([]);
  const [itemAddOnIds, setItemAddOnIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [sectionsCatalog, setSectionsCatalog] = useState([]);
  const [placementGroupSummary, setPlacementGroupSummary] = useState({});
  const [extraPlacements, setExtraPlacements] = useState([]);
  const [applyToAllLinked, setApplyToAllLinked] = useState(false);
  const [placementGroupId, setPlacementGroupId] = useState(null);
  const [removedPlacementIds, setRemovedPlacementIds] = useState([]);

  const sectionsCatalogRef = useRef([]);
  const categoriesRef = useRef([]);
  const lastLoadedCatRef = useRef(null);

  useEffect(() => {
    sectionsCatalogRef.current = sectionsCatalog;
  }, [sectionsCatalog]);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  // Category editor
  const [catEditMode, setCatEditMode] = useState(null);
  const [catEditData, setCatEditData] = useState({ name_en: "", name_ar: "", sort_order: 0 });

  // Section editor
  const [sectionEditId, setSectionEditId] = useState(null);
  const [sectionEditData, setSectionEditData] = useState({ name_en: "", name_ar: "" });

  // Add-on editor
  const [addonFormOpen, setAddonFormOpen] = useState(false);
  const [addonEditId, setAddonEditId] = useState(null);
  const [addonFormData, setAddonFormData] = useState({ name_en: "", name_ar: "", price: "" });
  const [addonSaving, setAddonSaving] = useState(false);

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
  }, []);

  // ── Data Loading ──

  const loadSectionsCatalog = useCallback(async () => {
    if (!supabase) return;
    try {
      let query = supabase
        .from("sections")
        .select("id, name_en, name_ar, category_id, sort_order, categories(name_en, slug)")
        .eq("branch_id", menuBranch)
        .order("sort_order");
      const { data, error } = await query;
      if (error) throw error;
      setSectionsCatalog(
        (data || []).map((s) => ({
          id: s.id,
          name_en: s.name_en,
          name_ar: s.name_ar,
          category_id: s.category_id,
          category_name_en: s.categories?.name_en || s.categories?.slug || "",
        })),
      );
    } catch (_) {
      setSectionsCatalog([]);
    }
  }, [menuBranch]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await getCategories({ branchId: menuBranch });
      const cats = Array.isArray(res?.data) ? res.data : [];
      setCategories(cats);
      return cats;
    } catch (e) {
      setError("Failed to load categories");
      return [];
    }
  }, [menuBranch]);

  const loadMenuForCategory = useCallback(async (catId) => {
    if (!catId || !supabase) return;
    setItemsLoading(true);
    try {
      const { data: sections, error: secErr } = await supabase
        .from("sections")
        .select("*")
        .eq("category_id", catId)
        .eq("branch_id", menuBranch)
        .order("sort_order");
      if (secErr) throw secErr;

      const secIds = (sections || []).map((s) => s.id);
      let items = [];
      if (secIds.length > 0) {
        const { data: itemData } = await supabase
          .from("menu_items")
          .select("*")
          .in("section_id", secIds)
          .eq("branch_id", menuBranch)
          .order("sort_order");
        items = itemData || [];
      }

      const result = (sections || []).map((sec) => ({
        ...sec,
        items: items.filter((it) => it.section_id === sec.id),
      }));
      setMenuData(result);
      const sectionState = {};
      result.forEach((s) => { sectionState[s.id] = true; });
      setExpandedSections((prev) => ({ ...prev, ...sectionState }));

      const flatItems = result.flatMap((s) => s.items || []);
      const groupIds = [
        ...new Set(flatItems.map((it) => it.placement_group_id).filter(Boolean)),
      ];
      if (groupIds.length > 0) {
        const { data: groupRows } = await fetchPlacementGroupIndex(groupIds);
        const catalog = sectionsCatalogRef.current;
        const cats = categoriesRef.current;
        const sectionsById = Object.fromEntries(catalog.map((s) => [s.id, s]));
        const categoriesById = Object.fromEntries(cats.map((c) => [c.id, c]));
        const merged = [...flatItems, ...(groupRows || [])];
        setPlacementGroupSummary(
          buildPlacementGroupSummary(merged, sectionsById, categoriesById),
        );
      } else {
        setPlacementGroupSummary({});
      }
    } catch (e) {
      setError("Failed to load menu items");
    } finally {
      setItemsLoading(false);
    }
  }, [menuBranch]);

  const loadAddOns = useCallback(async () => {
    try {
      const res = await getAddOns();
      setAddOns(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      showToast("Failed to load add-ons", "error");
    }
  }, [showToast]);

  const loadAllergens = useCallback(async () => {
    try {
      const res = await getAllergens();
      setAllergens(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      showToast("Failed to load allergens", "error");
    }
  }, [showToast]);

  useEffect(() => {
    const scoped = resolveMenuEditorBranch(rbac.profile, menuBranch);
    if (scoped && scoped !== menuBranch) setMenuBranch(scoped);
  }, [rbac.profile, menuBranch]);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      setError("Supabase is not configured. Add your keys to .env.local to use the Menu Manager.");
      return undefined;
    }

    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        const cats = await loadCategories();
        await Promise.all([loadSectionsCatalog(), loadAddOns(), loadAllergens()]);
        if (!cancelled) {
          setSelectedCatId(cats[0]?.id || null);
          lastLoadedCatRef.current = null;
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [menuBranch, loadCategories, loadSectionsCatalog, loadAddOns, loadAllergens]);

  useEffect(() => {
    if (!selectedCatId) return undefined;
    if (lastLoadedCatRef.current === selectedCatId) return undefined;
    lastLoadedCatRef.current = selectedCatId;
    loadMenuForCategory(selectedCatId);
    return undefined;
  }, [selectedCatId, loadMenuForCategory]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // ── Filtering ──

  const filteredSections = useMemo(() => {
    return menuData.map((section) => {
      let items = section.items || [];

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        items = items.filter(
          (item) =>
            (item.name_en || "").toLowerCase().includes(q) ||
            (item.name_ar || "").includes(q)
        );
      }

      if (activeFilter !== "all") {
        items = items.filter((item) => {
          switch (activeFilter) {
            case "sold_out": return item.sold_out;
            case "inactive": return isHiddenFromPublicMenu(item, nowMs);
            case "vegetarian": return item.vegetarian;
            case "new_item": return item.new_item;
            default: return true;
          }
        });
      }

      return { ...section, items };
    });
  }, [menuData, searchQuery, activeFilter, nowMs]);

  const totalFilteredItems = useMemo(
    () => filteredSections.reduce((sum, s) => sum + s.items.length, 0),
    [filteredSections]
  );

  // ── Category CRUD ──

  const handleSelectCategory = useCallback((catId) => {
    lastLoadedCatRef.current = null;
    setSelectedCatId(catId);
    setSearchQuery("");
    setActiveFilter("all");
  }, []);

  const handleAddCategory = useCallback(() => {
    setCatEditMode("create");
    setCatEditData({ name_en: "", name_ar: "", sort_order: categories.length });
  }, [categories.length]);

  const handleEditCategory = useCallback((cat, e) => {
    e.stopPropagation();
    setCatEditMode("edit");
    setCatEditData({
      id: cat.id,
      name_en: cat.name_en || "",
      name_ar: cat.name_ar || "",
      sort_order: cat.sort_order ?? 0,
    });
  }, []);

  const handleSaveCategory = useCallback(async () => {
    if (!catEditData.name_en.trim() || readOnlyMenu) return;
    try {
      assertMenuBranchAccess(rbac.profile, menuBranch);
      const payload = { ...catEditData, branch_id: menuBranch };
      if (catEditMode === "create") {
        await createCategory(payload);
        showToast("Category created");
      } else {
        await updateCategory(catEditData.id, catEditData);
        showToast("Category updated");
      }
      setCatEditMode(null);
      const cats = await loadCategories();
      if (!selectedCatId && cats.length > 0) {
        setSelectedCatId(cats[0].id);
      }
    } catch (e) {
      showToast(e?.message || "Failed to save category", "error");
    }
  }, [catEditMode, catEditData, loadCategories, showToast, selectedCatId, readOnlyMenu, rbac.profile, menuBranch]);

  const handleDeleteCategory = useCallback((cat, e) => {
    e.stopPropagation();
    setConfirm({
      title: "Delete Category",
      message: `Delete "${cat.name_en}"? All sections and items within will also be removed.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await deleteCategory(cat.id);
          showToast("Category deleted");
          const cats = await loadCategories();
          if (selectedCatId === cat.id) {
            setSelectedCatId(cats.length > 0 ? cats[0].id : null);
          }
        } catch (e) {
          showToast(e?.message || "Failed to delete category", "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [loadCategories, showToast, selectedCatId]);

  const handleReorderCategory = useCallback(async (index, direction) => {
    const newCats = [...categories];
    const swapIdx = index + direction;
    if (swapIdx < 0 || swapIdx >= newCats.length) return;
    [newCats[index], newCats[swapIdx]] = [newCats[swapIdx], newCats[index]];
    setCategories(newCats);
    try {
      const ordered = newCats.map((c, i) => ({ id: c.id, sort_order: i }));
      for (const item of ordered) {
        await updateCategory(item.id, { sort_order: item.sort_order });
      }
    } catch (e) {
      showToast("Failed to reorder", "error");
      loadCategories();
    }
  }, [categories, loadCategories, showToast]);

  // ── Section CRUD ──

  const handleAddSection = useCallback(async () => {
    if (!selectedCatId) return;
    const name = prompt("Section name (English):");
    if (!name?.trim() || readOnlyMenu) return;
    const nameAr = prompt("Section name (Arabic):") || "";
    try {
      assertMenuBranchAccess(rbac.profile, menuBranch);
      await createSection({
        name_en: name.trim(),
        name_ar: nameAr.trim(),
        category_id: selectedCatId,
        sort_order: menuData.length,
        branch_id: menuBranch,
      });
      showToast("Section created");
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to create section", "error");
    }
  }, [selectedCatId, menuData.length, showToast, loadMenuForCategory, readOnlyMenu, rbac.profile, menuBranch]);

  const handleSaveSection = useCallback(async (sectionId) => {
    try {
      await updateSection(sectionId, sectionEditData);
      showToast("Section updated");
      setSectionEditId(null);
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to update section", "error");
    }
  }, [sectionEditData, showToast, loadMenuForCategory, selectedCatId]);

  const handleDeleteSection = useCallback((section) => {
    setConfirm({
      title: "Delete Section",
      message: `Delete "${section.name_en}"? All items in this section will be removed.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await deleteSection(section.id);
          showToast("Section deleted");
          loadMenuForCategory(selectedCatId);
        } catch (e) {
          showToast(e?.message || "Failed to delete section", "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [showToast, loadMenuForCategory, selectedCatId]);

  const handleReorderSection = useCallback(async (index, direction) => {
    const newSections = [...menuData];
    const swapIdx = index + direction;
    if (swapIdx < 0 || swapIdx >= newSections.length) return;
    [newSections[index], newSections[swapIdx]] = [newSections[swapIdx], newSections[index]];
    setMenuData(newSections);
    try {
      const ordered = newSections.map((s, i) => ({ id: s.id, sort_order: i }));
      await reorderSections(ordered);
    } catch (e) {
      showToast("Failed to reorder sections", "error");
      loadMenuForCategory(selectedCatId);
    }
  }, [menuData, showToast, loadMenuForCategory, selectedCatId]);

  // ── Item CRUD ──

  const sectionsForCategory = useCallback(
    (categoryId) => {
      if (!categoryId) return [];
      return sectionsCatalog.filter((s) => s.category_id === categoryId);
    },
    [sectionsCatalog],
  );

  const resetPlacementEditor = useCallback(() => {
    setExtraPlacements([]);
    setApplyToAllLinked(false);
    setPlacementGroupId(null);
    setRemovedPlacementIds([]);
  }, []);

  const openCreateItem = useCallback((sectionId) => {
    setEditorMode("create");
    setEditingItem({
      ...EMPTY_ITEM,
      category_id: selectedCatId || "",
      section_id: sectionId || "",
    });
    setEditingItemId(null);
    setItemAllergenIds([]);
    setItemAddOnIds([]);
    setImageFile(null);
    setImagePreview("");
    resetPlacementEditor();
    setEditorOpen(true);
  }, [selectedCatId, resetPlacementEditor]);

  const openEditItem = useCallback(async (item) => {
    const secRow = sectionsCatalog.find((s) => s.id === item.section_id);
    const categoryId = secRow?.category_id || item.category_id || selectedCatId || "";

    setEditorMode("edit");
    setEditingItem({
      name_en: item.name_en || "",
      name_ar: item.name_ar || "",
      desc_en: item.desc_en || "",
      desc_ar: item.desc_ar || "",
      price: item.price ?? "",
      calories: item.calories ?? "",
      image: item.image || "",
      category_id: categoryId,
      section_id: item.section_id || "",
      sold_out: item.sold_out || false,
      featured: item.featured || false,
      new_item: item.new_item || false,
      vegetarian: item.vegetarian || false,
      vegan: item.vegan || false,
      active: item.active !== false,
      hidden_until: item.hidden_until || null,
    });
    setEditingItemId(item.id);
    setItemAllergenIds((item.allergens || []).map((a) => a.id || a));
    setItemAddOnIds((item.add_ons || []).map((a) => a.id || a));
    setImageFile(null);
    setImagePreview(item.image || "");
    setApplyToAllLinked(false);
    setRemovedPlacementIds([]);

    const groupId = item.placement_group_id || null;
    setPlacementGroupId(groupId);

    if (groupId) {
      const { data: members } = await fetchPlacementGroupMembers(groupId);
      const extras = (members || [])
        .filter((m) => m.id !== item.id)
        .map((m) => {
          const sec = sectionsCatalog.find((s) => s.id === m.section_id);
          return {
            itemId: m.id,
            category_id: sec?.category_id || "",
            section_id: m.section_id,
          };
        });
      setExtraPlacements(extras);
    } else {
      setExtraPlacements([]);
    }

    setEditorOpen(true);
  }, [selectedCatId, sectionsCatalog]);

  const handleSaveItem = useCallback(async () => {
    if (readOnlyMenu) {
      showToast("Read-only menu access", "error");
      return;
    }
    if (!editingItem.name_en.trim()) {
      showToast("Name (English) is required", "error");
      return;
    }
    setSaving(true);
    try {
      assertMenuBranchAccess(rbac.profile, menuBranch);
      let imgUrl = editingItem.image;

      if (imageFile) {
        const path = `items/${editingItemId || `new-${Date.now()}`}.jpg`;
        const { data: uploaded, error: uploadErr } = await uploadMenuImage(imageFile, path);
        if (uploadErr) throw uploadErr;
        if (uploaded?.publicUrl) imgUrl = uploaded.publicUrl;
      }

      const primaryPlacement = {
        category_id: editingItem.category_id,
        section_id: editingItem.section_id,
      };
      const placementCheck = validatePlacements(primaryPlacement, extraPlacements);
      if (!placementCheck.ok) {
        showToast(placementCheck.message, "error");
        return;
      }

      const contentPayload = sanitizeMenuItemPayload({
        name_en: editingItem.name_en.trim(),
        name_ar: editingItem.name_ar?.trim() || "",
        desc_en: editingItem.desc_en || "",
        desc_ar: editingItem.desc_ar || "",
        price: editingItem.price || "",
        calories: editingItem.calories || "-",
        image: imgUrl || "",
        sold_out: Boolean(editingItem.sold_out),
        featured: Boolean(editingItem.featured),
        new_item: Boolean(editingItem.new_item),
        vegetarian: Boolean(editingItem.vegetarian),
        vegan: Boolean(editingItem.vegan),
        active: editingItem.active !== false,
        hidden_until: editingItem.hidden_until || null,
        branch_id: menuBranch,
      });

      let itemId = editingItemId;
      const extraSectionIds = extraPlacements
        .map((p) => p.section_id)
        .filter(Boolean);

      if (editorMode === "create") {
        const result = await createMenuItemPlacements({
          contentPayload,
          primarySectionId: primaryPlacement.section_id,
          extraSectionIds,
          allergenIds: itemAllergenIds,
          addonIds: itemAddOnIds,
        });
        if (result.error) throw result.error;
        itemId = result.data?.id;
        if (!itemId) throw new Error("Create succeeded but no item id returned");
        const count = (result.created || []).length;
        showToast(
          count > 1 ? `Item created in ${count} placements` : "Item created",
        );
      } else {
        await updateMenuItemPlacements({
          itemId: editingItemId,
          contentPayload,
          primarySectionId: primaryPlacement.section_id,
          extraPlacements: extraPlacements.map((p) => ({
            itemId: p.itemId || null,
            sectionId: p.section_id,
          })),
          removePlacementItemIds: removedPlacementIds,
          syncLinked: applyToAllLinked,
          placementGroupId,
          allergenIds: itemAllergenIds,
          addonIds: itemAddOnIds,
        });
        showToast(
          applyToAllLinked && placementGroupId
            ? "Item updated across all linked placements"
            : "Item updated",
        );
      }

      const { data: verified, error: verifyErr } = await fetchMenuItemById(itemId);
      if (verifyErr) throw verifyErr;
      if (verified.sold_out !== contentPayload.sold_out) {
        throw new Error("Sold out did not persist — check Supabase column and permissions");
      }

      setEditorOpen(false);
      resetPlacementEditor();
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to save item", "error");
      await loadMenuForCategory(selectedCatId);
    } finally {
      setSaving(false);
    }
  }, [
    editingItem,
    editorMode,
    editingItemId,
    imageFile,
    itemAllergenIds,
    itemAddOnIds,
    extraPlacements,
    applyToAllLinked,
    placementGroupId,
    removedPlacementIds,
    showToast,
    loadMenuForCategory,
    selectedCatId,
    resetPlacementEditor,
    menuBranch,
    rbac.profile,
    readOnlyMenu,
  ]);

  const handleToggleSoldOut = useCallback(async (item) => {
    const newVal = !item.sold_out;
    try {
      assertMenuMutation(await toggleSoldOut(item.id, newVal), "toggleSoldOut");
      const { data: verified } = await fetchMenuItemById(item.id);
      if (verified && Boolean(verified.sold_out) !== newVal) {
        throw new Error("Sold out did not persist");
      }
      showToast(newVal ? "Marked sold out" : "Marked available");
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to update sold out", "error");
      await loadMenuForCategory(selectedCatId);
    }
  }, [showToast, loadMenuForCategory, selectedCatId]);

  const openVisibilityModal = useCallback((item) => {
    const untilMs = parseHiddenUntil(item);
    let mode = "active";
    if (item.active === false) mode = "indefinite";
    else if (untilMs != null && untilMs > Date.now()) mode = "datetime";
    setVisibilityForm({
      mode,
      hours: "2",
      dateTime: untilMs != null && untilMs > Date.now() ? toDatetimeLocalValue(untilMs) : "",
      soldOut: Boolean(item.sold_out),
    });
    setVisibilityTarget(item);
  }, []);

  const handleSaveVisibility = useCallback(async () => {
    if (!visibilityTarget) return;
    setVisibilityLoading(true);
    try {
      const patch = resolveVisibilityPatch(visibilityForm);
      assertMenuMutation(
        await applyMenuItemVisibility(visibilityTarget.id, patch),
        "applyMenuItemVisibility",
      );
      const { data: verified, error: verifyErr } = await fetchMenuItemById(visibilityTarget.id);
      if (verifyErr) throw verifyErr;
      if (Boolean(verified.sold_out) !== patch.sold_out) {
        throw new Error("Sold out did not persist");
      }
      setVisibilityTarget(null);
      showToast("Visibility saved");
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to save visibility", "error");
      await loadMenuForCategory(selectedCatId);
    } finally {
      setVisibilityLoading(false);
    }
  }, [visibilityTarget, visibilityForm, showToast, loadMenuForCategory, selectedCatId]);

  const handleDuplicateItem = useCallback(async (item, e) => {
    e.stopPropagation();
    try {
      await duplicateMenuItem(item.id);
      showToast("Item duplicated");
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to duplicate", "error");
    }
  }, [showToast, loadMenuForCategory, selectedCatId]);

  const handleDeleteItem = useCallback((item, e) => {
    e.stopPropagation();
    setConfirm({
      title: "Delete Item",
      message: `Delete "${item.name_en}"? This action cannot be undone.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await deleteMenuItem(item.id);
          showToast("Item deleted");
          loadMenuForCategory(selectedCatId);
        } catch (e) {
          showToast(e?.message || "Failed to delete item", "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [showToast, loadMenuForCategory, selectedCatId]);

  const handleReorderItem = useCallback(async (sectionIdx, itemIdx, direction) => {
    const newSections = [...menuData];
    const items = [...newSections[sectionIdx].items];
    const swapIdx = itemIdx + direction;
    if (swapIdx < 0 || swapIdx >= items.length) return;
    [items[itemIdx], items[swapIdx]] = [items[swapIdx], items[itemIdx]];
    newSections[sectionIdx] = { ...newSections[sectionIdx], items };
    setMenuData(newSections);
    try {
      const ordered = items.map((it, i) => ({ id: it.id, sort_order: i }));
      await reorderItems(ordered);
    } catch (e) {
      showToast("Failed to reorder", "error");
      loadMenuForCategory(selectedCatId);
    }
  }, [menuData, showToast, loadMenuForCategory, selectedCatId]);

  // ── Image handling ──

  const handleImageSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleImageDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveImage = useCallback(async () => {
    if (editingItem.image && editingItemId) {
      try { await deleteMenuImage(editingItemId); } catch (_) {}
    }
    setImageFile(null);
    setImagePreview("");
    setEditingItem((prev) => ({ ...prev, image: "" }));
  }, [editingItem.image, editingItemId]);

  // ── Add-on CRUD ──

  const handleSaveAddOn = useCallback(async () => {
    if (!addonFormData.name_en.trim()) return;
    setAddonSaving(true);
    try {
      const payload = {
        ...addonFormData,
        price: addonFormData.price !== "" ? Number(addonFormData.price) : null,
      };
      if (addonEditId) {
        await updateAddOn(addonEditId, payload);
        showToast("Add-on updated");
      } else {
        await createAddOn(payload);
        showToast("Add-on created");
      }
      setAddonFormOpen(false);
      setAddonEditId(null);
      setAddonFormData({ name_en: "", name_ar: "", price: "" });
      loadAddOns();
    } catch (e) {
      showToast(e?.message || "Failed to save add-on", "error");
    } finally {
      setAddonSaving(false);
    }
  }, [addonFormData, addonEditId, showToast, loadAddOns]);

  const handleDeleteAddOn = useCallback((addon) => {
    setConfirm({
      title: "Delete Add-on",
      message: `Delete "${addon.name_en}"? Items using this add-on will be unlinked.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          await deleteAddOn(addon.id);
          showToast("Add-on deleted");
          loadAddOns();
        } catch (e) {
          showToast(e?.message || "Failed to delete add-on", "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [showToast, loadAddOns]);

  // ── Toggle section expand ──

  const toggleSection = useCallback((sectionId) => {
    setExpandedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  // ── Render helpers ──

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === selectedCatId),
    [categories, selectedCatId]
  );

  const usedPlacementKeys = useMemo(() => {
    const keys = new Set();
    if (editingItem.category_id && editingItem.section_id) {
      keys.add(`${editingItem.category_id}:${editingItem.section_id}`);
    }
    extraPlacements.forEach((p) => {
      if (p.category_id && p.section_id) keys.add(`${p.category_id}:${p.section_id}`);
    });
    return keys;
  }, [editingItem.category_id, editingItem.section_id, extraPlacements]);

  const addExtraPlacement = useCallback(() => {
    setExtraPlacements((prev) => [...prev, { category_id: "", section_id: "" }]);
  }, []);

  const updateExtraPlacement = useCallback((index, patch) => {
    setExtraPlacements((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }, []);

  const removeExtraPlacement = useCallback((index) => {
    setExtraPlacements((prev) => {
      const row = prev[index];
      if (row?.itemId) {
        setRemovedPlacementIds((ids) =>
          ids.includes(row.itemId) ? ids : [...ids, row.itemId],
        );
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  if (loading) {
    return (
      <div className="mm">
        <div className="mm-bg-glow" />
        <div className="mm-sidebar">
          <div className="mm-sidebar-header">
            <p className="mm-sidebar-title">Categories</p>
          </div>
          <div className="mm-cat-list">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="mm-skeleton" style={{ height: 44, marginBottom: 6 }} />
            ))}
          </div>
        </div>
        <div className="mm-main">
          <div className="mm-topbar">
            <div className="mm-topbar-row">
              <div>
                <div className="mm-skeleton" style={{ height: 28, width: 200, marginBottom: 8 }} />
                <div className="mm-skeleton" style={{ height: 14, width: 140 }} />
              </div>
            </div>
          </div>
          <div className="mm-content">
            <div className="mm-loading">
              <div className="mm-spinner" />
              Loading menu data…
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mm">
      <div
        className="mm-branch-bar"
        style={{ display: "flex", gap: "0.75rem", alignItems: "center", padding: "0.65rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.8rem" }}>
          Branch
          <select
            value={menuBranch}
            disabled={!rbac.canAccessAllBranches()}
            onChange={(e) => setMenuBranch(e.target.value)}
          >
            {menuBranchOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {readOnlyMenu && (
          <span style={{ fontSize: "0.75rem", opacity: 0.75 }}>Read-only menu view</span>
        )}
      </div>
      <div className="mm-bg-glow" />

      {/* ═══ SIDEBAR ═══ */}
      <aside className="mm-sidebar">
        <div className="mm-sidebar-header">
          <p className="mm-sidebar-title">Categories</p>
          <button className="mm-sidebar-add-btn" onClick={handleAddCategory}>
            <Plus size={14} />
            Add Category
          </button>
        </div>

        {/* Category Create/Edit Form */}
        <AnimatePresence>
          {catEditMode && (
            <motion.div
              className="mm-cat-edit-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="mm-cat-edit-form-row">
                <input
                  className="mm-field-input"
                  placeholder="Name (EN)"
                  value={catEditData.name_en}
                  onChange={(e) => setCatEditData((p) => ({ ...p, name_en: e.target.value }))}
                  autoFocus
                />
                <input
                  className="mm-field-input"
                  placeholder="الاسم (AR)"
                  dir="rtl"
                  value={catEditData.name_ar}
                  onChange={(e) => setCatEditData((p) => ({ ...p, name_ar: e.target.value }))}
                />
              </div>
              <div className="mm-cat-edit-actions">
                <button className="mm-btn mm-btn-secondary" onClick={() => setCatEditMode(null)} style={{ flex: 0, padding: "6px 14px", fontSize: 12 }}>
                  Cancel
                </button>
                <button className="mm-btn mm-btn-primary" onClick={handleSaveCategory} style={{ flex: 0, padding: "6px 14px", fontSize: 12 }}>
                  <Check size={13} />
                  {catEditMode === "create" ? "Create" : "Save"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mm-cat-list">
          {categories.map((cat, idx) => (
            <motion.div
              key={cat.id}
              role="button"
              tabIndex={0}
              className={`mm-cat-item ${cat.id === selectedCatId ? "active" : ""} ${cat.active === false ? "mm-cat-item-inactive" : ""}`}
              onClick={() => handleSelectCategory(cat.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelectCategory(cat.id);
                }
              }}
              whileHover={{ x: 3 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="mm-cat-item-name">
                {cat.name_en || cat.id}
              </span>
              <div className="mm-cat-actions">
                <button
                  className="mm-cat-reorder-btn"
                  onClick={(e) => { e.stopPropagation(); handleReorderCategory(idx, -1); }}
                  disabled={idx === 0}
                  title="Move up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="mm-cat-reorder-btn"
                  onClick={(e) => { e.stopPropagation(); handleReorderCategory(idx, 1); }}
                  disabled={idx === categories.length - 1}
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  className="mm-cat-reorder-btn"
                  onClick={(e) => handleEditCategory(cat, e)}
                  title="Edit"
                >
                  <Edit3 size={13} />
                </button>
                <button
                  className="mm-cat-reorder-btn"
                  onClick={(e) => handleDeleteCategory(cat, e)}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </motion.div>
          ))}

          {categories.length === 0 && (
            <div className="mm-empty" style={{ height: 120, fontSize: 12 }}>
              <UtensilsCrossed size={24} />
              No categories yet
            </div>
          )}
        </div>
      </aside>

      {/* ═══ MAIN AREA ═══ */}
      <main className="mm-main">
        <div className="mm-topbar">
          <div className="mm-topbar-row">
            <div>
              <h2 className="mm-topbar-title">
                {selectedCategory ? selectedCategory.name_en : "Menu"}
              </h2>
              <p className="mm-topbar-subtitle">
                {selectedCategory
                  ? `${totalFilteredItems} item${totalFilteredItems !== 1 ? "s" : ""}${searchQuery || activeFilter !== "all" ? " (filtered)" : ""}`
                  : "Select a category to manage items"}
              </p>
            </div>
            <div className="mm-tab-bar">
              <button
                className={`mm-tab ${activeTab === "menu" ? "active" : ""}`}
                onClick={() => setActiveTab("menu")}
              >
                <LayoutGrid size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                Menu Items
              </button>
              <button
                className={`mm-tab ${activeTab === "addons" ? "active" : ""}`}
                onClick={() => setActiveTab("addons")}
              >
                <Package size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                Add-ons
              </button>
            </div>
          </div>

          {activeTab === "menu" && selectedCatId && (
            <div className="mm-search-bar">
              <div className="mm-search-input-wrap">
                <Search size={16} />
                <input
                  className="mm-search-input"
                  placeholder="Search items…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="mm-filter-pills">
                {FILTER_OPTIONS.map((f) => (
                  <button
                    key={f.key}
                    className={`mm-filter-pill ${activeFilter === f.key ? "active" : ""}`}
                    onClick={() => setActiveFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mm-content">
          {error && (
            <div className="mm-error-state">
              <AlertCircle size={16} />
              {error}
              <button
                className="mm-btn mm-btn-secondary"
                style={{ marginLeft: "auto", padding: "4px 12px", fontSize: 12 }}
                onClick={() => { setError(""); loadMenuForCategory(selectedCatId); }}
              >
                Retry
              </button>
            </div>
          )}

          {/* ── MENU TAB ── */}
          {activeTab === "menu" && (
            <>
              {!selectedCatId && (
                <div className="mm-empty">
                  <UtensilsCrossed size={36} />
                  <span>Select a category from the sidebar</span>
                </div>
              )}

              {selectedCatId && itemsLoading && (
                <div className="mm-loading">
                  <div className="mm-spinner" />
                  Loading items…
                </div>
              )}

              {selectedCatId && !itemsLoading && (
                <>
                  {filteredSections.map((section, sectionIdx) => (
                    <div className="mm-section" key={section.id}>
                      <div
                        className="mm-section-header"
                        onClick={() => toggleSection(section.id)}
                      >
                        <ChevronRight
                          size={16}
                          className={`mm-section-chevron ${expandedSections[section.id] ? "open" : ""}`}
                        />

                        {sectionEditId === section.id ? (
                          <div className="mm-section-edit-form" onClick={(e) => e.stopPropagation()}>
                            <input
                              className="mm-inline-input"
                              value={sectionEditData.name_en}
                              onChange={(e) => setSectionEditData((p) => ({ ...p, name_en: e.target.value }))}
                              placeholder="Name (EN)"
                              autoFocus
                            />
                            <input
                              className="mm-inline-input"
                              value={sectionEditData.name_ar}
                              onChange={(e) => setSectionEditData((p) => ({ ...p, name_ar: e.target.value }))}
                              placeholder="الاسم (AR)"
                              dir="rtl"
                              style={{ width: 120 }}
                            />
                            <button
                              className="mm-section-action-btn"
                              onClick={() => handleSaveSection(section.id)}
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              className="mm-section-action-btn"
                              onClick={() => setSectionEditId(null)}
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="mm-section-name">
                              {section.name_en}
                              {section.name_ar && (
                                <span className="mm-section-name-ar">{section.name_ar}</span>
                              )}
                            </span>
                            <span className="mm-section-badge">
                              {section.items.length} item{section.items.length !== 1 ? "s" : ""}
                            </span>
                          </>
                        )}

                        <div className="mm-section-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="mm-section-action-btn"
                            onClick={() => handleReorderSection(sectionIdx, -1)}
                            disabled={sectionIdx === 0}
                            title="Move up"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            className="mm-section-action-btn"
                            onClick={() => handleReorderSection(sectionIdx, 1)}
                            disabled={sectionIdx === filteredSections.length - 1}
                            title="Move down"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            className="mm-section-action-btn"
                            onClick={() => {
                              setSectionEditId(section.id);
                              setSectionEditData({ name_en: section.name_en || "", name_ar: section.name_ar || "" });
                            }}
                            title="Edit section"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            className="mm-section-action-btn danger"
                            onClick={() => handleDeleteSection(section)}
                            title="Delete section"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {expandedSections[section.id] && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25 }}
                          >
                            <div className="mm-item-grid">
                              {section.items.map((item, itemIdx) => {
                                const visBadge = getItemVisibilityBadge(item, nowMs);
                                const guestHidden = visBadge.key !== "active";
                                const linkedBadge = formatLinkedPlacementBadge(
                                  item,
                                  selectedCatId,
                                  placementGroupSummary,
                                );
                                return (
                                <motion.div
                                  key={item.id}
                                  className={`mm-item-card ${guestHidden ? "inactive" : ""}`}
                                  onClick={() => openEditItem(item)}
                                  whileHover={{ y: -3 }}
                                  initial={{ opacity: 0, y: 12 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: itemIdx * 0.03 }}
                                >
                                  <div className="mm-item-card-img-wrap">
                                    {item.image ? (
                                      <img
                                        src={item.image}
                                        alt={item.name_en}
                                        className="mm-item-card-img"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <ImageIcon size={28} className="mm-item-card-no-img" />
                                    )}
                                  </div>

                                  <div className="mm-item-card-name">{item.name_en}</div>
                                  <div className="mm-item-card-price">
                                    {item.price || "—"}
                                  </div>

                                  <div className="mm-item-card-badges">
                                    <span className={`mm-badge mm-badge-visibility mm-badge-visibility-${visBadge.key}`}>
                                      {visBadge.label}
                                    </span>
                                    {item.sold_out && <span className="mm-badge mm-badge-sold-out">Sold Out</span>}
                                    {item.featured && <span className="mm-badge mm-badge-featured">Featured</span>}
                                    {item.new_item && <span className="mm-badge mm-badge-new">New</span>}
                                    {item.vegetarian && <span className="mm-badge mm-badge-veg">Veg</span>}
                                    {item.vegan && <span className="mm-badge mm-badge-vegan">Vegan</span>}
                                    {linkedBadge && (
                                      <span className="mm-badge mm-badge-linked" title={linkedBadge}>
                                        {linkedBadge}
                                      </span>
                                    )}
                                  </div>

                                  <div className="mm-item-card-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      className={`mm-item-action-btn ${item.sold_out ? "sold-out-active" : ""}`}
                                      onClick={() => handleToggleSoldOut(item)}
                                      title={item.sold_out ? "Mark available" : "Mark sold out"}
                                    >
                                      <Ban size={14} />
                                    </button>
                                    <button
                                      className={`mm-item-action-btn ${!guestHidden ? "active-toggle" : ""}`}
                                      onClick={() => openVisibilityModal(item)}
                                      title="Guest menu visibility"
                                    >
                                      <Eye size={14} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn"
                                      onClick={() => openEditItem(item)}
                                      title="Edit"
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn"
                                      onClick={(e) => handleDuplicateItem(item, e)}
                                      title="Duplicate"
                                    >
                                      <Copy size={14} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn"
                                      onClick={(e) => { e.stopPropagation(); handleReorderItem(sectionIdx, itemIdx, -1); }}
                                      disabled={itemIdx === 0}
                                      title="Move up"
                                    >
                                      <ChevronUp size={12} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn"
                                      onClick={(e) => { e.stopPropagation(); handleReorderItem(sectionIdx, itemIdx, 1); }}
                                      disabled={itemIdx === section.items.length - 1}
                                      title="Move down"
                                    >
                                      <ChevronDown size={12} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn danger"
                                      onClick={(e) => handleDeleteItem(item, e)}
                                      title="Delete"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </motion.div>
                                );
                              })}

                              <div
                                className="mm-add-item-card"
                                onClick={() => openCreateItem(section.id)}
                              >
                                <Plus size={22} />
                                Add item
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}

                  <button className="mm-add-section-btn" onClick={handleAddSection}>
                    <Plus size={16} />
                    Add Section
                  </button>

                  {filteredSections.length === 0 && !itemsLoading && (
                    <div className="mm-empty">
                      <UtensilsCrossed size={36} />
                      {searchQuery || activeFilter !== "all"
                        ? "No items match your filters"
                        : "No sections yet — create one to add items"}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── ADD-ONS TAB ── */}
          {activeTab === "addons" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Add-ons</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(249,249,247,0.45)" }}>
                    {addOns.length} add-on{addOns.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <button
                  className="mm-btn mm-btn-gold"
                  onClick={() => {
                    setAddonFormOpen(true);
                    setAddonEditId(null);
                    setAddonFormData({ name_en: "", name_ar: "", price: "" });
                  }}
                >
                  <Plus size={14} />
                  New Add-on
                </button>
              </div>

              <AnimatePresence>
                {addonFormOpen && (
                  <motion.div
                    className="mm-addon-form"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <h4 className="mm-addon-form-title">
                      {addonEditId ? "Edit Add-on" : "New Add-on"}
                    </h4>
                    <div className="mm-addon-form-row">
                      <input
                        className="mm-field-input"
                        placeholder="Name (EN)"
                        value={addonFormData.name_en}
                        onChange={(e) => setAddonFormData((p) => ({ ...p, name_en: e.target.value }))}
                        autoFocus
                      />
                      <input
                        className="mm-field-input"
                        placeholder="الاسم (AR)"
                        dir="rtl"
                        value={addonFormData.name_ar}
                        onChange={(e) => setAddonFormData((p) => ({ ...p, name_ar: e.target.value }))}
                      />
                      <input
                        className="mm-field-input"
                        placeholder="e.g. 25 SAR"
                        value={addonFormData.price}
                        onChange={(e) => setAddonFormData((p) => ({ ...p, price: e.target.value }))}
                      />
                    </div>
                    <div className="mm-addon-form-actions">
                      <button
                        className="mm-btn mm-btn-secondary"
                        style={{ flex: 0 }}
                        onClick={() => { setAddonFormOpen(false); setAddonEditId(null); }}
                      >
                        Cancel
                      </button>
                      <button
                        className="mm-btn mm-btn-primary"
                        style={{ flex: 0 }}
                        onClick={handleSaveAddOn}
                        disabled={addonSaving || !addonFormData.name_en.trim()}
                      >
                        {addonSaving ? <Loader2 size={14} className="mm-spin-icon" /> : <Check size={14} />}
                        {addonEditId ? "Update" : "Create"}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mm-addon-list">
                {addOns.map((addon) => (
                  <motion.div
                    className="mm-addon-card"
                    key={addon.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ x: 3 }}
                  >
                    <Package size={16} style={{ color: "#d7bc8a", flexShrink: 0 }} />
                    <div className="mm-addon-name">
                      {addon.name_en}
                      {addon.name_ar && <div className="mm-addon-name-ar">{addon.name_ar}</div>}
                    </div>
                    <span className="mm-addon-price">
                      {addon.price || "—"}
                    </span>
                    <div className="mm-addon-actions">
                      <button
                        className="mm-item-action-btn"
                        onClick={() => {
                          setAddonFormOpen(true);
                          setAddonEditId(addon.id);
                          setAddonFormData({
                            name_en: addon.name_en || "",
                            name_ar: addon.name_ar || "",
                            price: addon.price ?? "",
                          });
                        }}
                        title="Edit"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        className="mm-item-action-btn danger"
                        onClick={() => handleDeleteAddOn(addon)}
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                ))}

                {addOns.length === 0 && (
                  <div className="mm-empty">
                    <Package size={36} />
                    No add-ons yet
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ═══ EDITOR PANEL ═══ */}
      <AnimatePresence>
        {editorOpen && (
          <>
            <motion.div
              className="mm-editor-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditorOpen(false)}
            />
            <motion.div
              className="mm-editor"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
            >
              <div className="mm-editor-header">
                <h3>{editorMode === "create" ? "New Item" : "Edit Item"}</h3>
                <button className="mm-editor-close" onClick={() => setEditorOpen(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="mm-editor-body">
                {/* Image Upload */}
                <div className="mm-field">
                  <label className="mm-field-label">Image</label>
                  <div
                    className={`mm-img-upload ${imagePreview ? "has-img" : ""}`}
                    onClick={() => document.getElementById("mm-img-input").click()}
                    onDrop={handleImageDrop}
                    onDragOver={(e) => e.preventDefault()}
                  >
                    {imagePreview ? (
                      <>
                        <img src={imagePreview} alt="Preview" className="mm-img-upload-preview" />
                        <button
                          className="mm-img-upload-remove"
                          onClick={(e) => { e.stopPropagation(); handleRemoveImage(); }}
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload size={24} style={{ color: "rgba(249,249,247,0.3)" }} />
                        <span className="mm-img-upload-text">Drop image or click to upload</span>
                      </>
                    )}
                    <input
                      id="mm-img-input"
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={handleImageSelect}
                    />
                  </div>
                </div>

                {/* Name fields */}
                <div className="mm-field-row">
                  <div className="mm-field">
                    <label className="mm-field-label">Name (English)</label>
                    <input
                      className="mm-field-input"
                      value={editingItem.name_en}
                      onChange={(e) => setEditingItem((p) => ({ ...p, name_en: e.target.value }))}
                      placeholder="Item name"
                    />
                  </div>
                  <div className="mm-field">
                    <label className="mm-field-label">Name (Arabic)</label>
                    <input
                      className="mm-field-input"
                      dir="rtl"
                      value={editingItem.name_ar}
                      onChange={(e) => setEditingItem((p) => ({ ...p, name_ar: e.target.value }))}
                      placeholder="اسم الطبق"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="mm-field">
                  <label className="mm-field-label">Description (English)</label>
                  <textarea
                    className="mm-field-textarea"
                    value={editingItem.desc_en}
                    onChange={(e) => setEditingItem((p) => ({ ...p, desc_en: e.target.value }))}
                    placeholder="Describe the dish…"
                  />
                </div>
                <div className="mm-field">
                  <label className="mm-field-label">Description (Arabic)</label>
                  <textarea
                    className="mm-field-textarea"
                    dir="rtl"
                    value={editingItem.desc_ar}
                    onChange={(e) => setEditingItem((p) => ({ ...p, desc_ar: e.target.value }))}
                    placeholder="وصف الطبق…"
                  />
                </div>

                {/* Price & Calories */}
                <div className="mm-field-row">
                  <div className="mm-field">
                    <label className="mm-field-label">Price</label>
                    <input
                      className="mm-field-input"
                      value={editingItem.price}
                      onChange={(e) => setEditingItem((p) => ({ ...p, price: e.target.value }))}
                      placeholder="e.g. 52 SAR"
                    />
                  </div>
                  <div className="mm-field">
                    <label className="mm-field-label">Calories</label>
                    <input
                      className="mm-field-input"
                      value={editingItem.calories}
                      onChange={(e) => setEditingItem((p) => ({ ...p, calories: e.target.value }))}
                      placeholder="e.g. 817 or -"
                    />
                  </div>
                </div>

                {/* Placements */}
                <div className="mm-placement-block">
                  <label className="mm-field-label">Primary placement</label>
                  <div className="mm-field-row">
                    <div className="mm-field">
                      <label className="mm-field-label mm-field-label-sub">Category</label>
                      <select
                        className="mm-field-select"
                        value={editingItem.category_id}
                        onChange={(e) => {
                          const categoryId = e.target.value;
                          const secs = sectionsForCategory(categoryId);
                          setEditingItem((p) => ({
                            ...p,
                            category_id: categoryId,
                            section_id: secs[0]?.id || "",
                          }));
                        }}
                      >
                        <option value="">Select category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name_en || c.id}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mm-field">
                      <label className="mm-field-label mm-field-label-sub">Section</label>
                      <select
                        className="mm-field-select"
                        value={editingItem.section_id}
                        onChange={(e) =>
                          setEditingItem((p) => ({ ...p, section_id: e.target.value }))
                        }
                      >
                        <option value="">Select section</option>
                        {sectionsForCategory(editingItem.category_id).map((s) => (
                          <option key={s.id} value={s.id}>{s.name_en}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {extraPlacements.length > 0 && (
                    <div className="mm-placement-extras">
                      <label className="mm-field-label">Additional placements</label>
                      {extraPlacements.map((placement, index) => {
                        const rowSections = sectionsForCategory(placement.category_id);
                        return (
                          <div className="mm-placement-extra-row" key={placement.itemId || `new-${index}`}>
                            <div className="mm-field-row">
                              <div className="mm-field">
                                <select
                                  className="mm-field-select"
                                  value={placement.category_id}
                                  onChange={(e) => {
                                    const categoryId = e.target.value;
                                    const secs = sectionsForCategory(categoryId);
                                    let sectionId = placement.section_id;
                                    const key = `${categoryId}:${sectionId}`;
                                    if (!sectionId || usedPlacementKeys.has(key)) {
                                      sectionId =
                                        secs.find(
                                          (s) =>
                                            !usedPlacementKeys.has(`${categoryId}:${s.id}`) ||
                                            s.id === placement.section_id,
                                        )?.id || secs[0]?.id || "";
                                    }
                                    updateExtraPlacement(index, {
                                      category_id: categoryId,
                                      section_id: sectionId,
                                    });
                                  }}
                                >
                                  <option value="">Category</option>
                                  {categories.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name_en}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="mm-field">
                                <select
                                  className="mm-field-select"
                                  value={placement.section_id}
                                  onChange={(e) =>
                                    updateExtraPlacement(index, { section_id: e.target.value })
                                  }
                                >
                                  <option value="">Section</option>
                                  {rowSections.map((s) => {
                                    const key = `${placement.category_id}:${s.id}`;
                                    const taken =
                                      usedPlacementKeys.has(key) &&
                                      key !== `${placement.category_id}:${placement.section_id}`;
                                    return (
                                      <option key={s.id} value={s.id} disabled={taken}>
                                        {s.name_en}
                                        {taken ? " (in use)" : ""}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="mm-placement-remove"
                              onClick={() => removeExtraPlacement(index)}
                              aria-label="Remove placement"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    className="mm-btn mm-btn-secondary mm-placement-add"
                    onClick={addExtraPlacement}
                  >
                    <Plus size={14} />
                    Add another placement
                  </button>

                  {editorMode === "edit" && (placementGroupId || extraPlacements.length > 0) && (
                    <label className="mm-linked-sync">
                      <input
                        type="checkbox"
                        checked={applyToAllLinked}
                        onChange={(e) => setApplyToAllLinked(e.target.checked)}
                      />
                      <span>Apply changes to all linked placements</span>
                    </label>
                  )}
                </div>

                {/* Toggles */}
                <div className="mm-field">
                  <label className="mm-field-label">Options</label>
                  <div className="mm-toggles-grid">
                    <div className="mm-toggle-row">
                      <span className="mm-toggle-label">Sold Out</span>
                      <ToggleSwitch
                        value={editingItem.sold_out}
                        onChange={(v) => setEditingItem((p) => ({ ...p, sold_out: v }))}
                      />
                    </div>
                    <div className="mm-toggle-row">
                      <span className="mm-toggle-label">Featured</span>
                      <ToggleSwitch
                        value={editingItem.featured}
                        onChange={(v) => setEditingItem((p) => ({ ...p, featured: v }))}
                      />
                    </div>
                    <div className="mm-toggle-row">
                      <span className="mm-toggle-label">New Item</span>
                      <ToggleSwitch
                        value={editingItem.new_item}
                        onChange={(v) => setEditingItem((p) => ({ ...p, new_item: v }))}
                      />
                    </div>
                    <div className="mm-toggle-row">
                      <span className="mm-toggle-label">Vegetarian</span>
                      <ToggleSwitch
                        value={editingItem.vegetarian}
                        onChange={(v) => setEditingItem((p) => ({ ...p, vegetarian: v }))}
                      />
                    </div>
                    <div className="mm-toggle-row">
                      <span className="mm-toggle-label">Vegan</span>
                      <ToggleSwitch
                        value={editingItem.vegan}
                        onChange={(v) => setEditingItem((p) => ({ ...p, vegan: v }))}
                      />
                    </div>
                    <div className="mm-toggle-row">
                      <span className="mm-toggle-label">Active</span>
                      <ToggleSwitch
                        value={editingItem.active}
                        onChange={(v) => setEditingItem((p) => ({ ...p, active: v }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Allergens */}
                {allergens.length > 0 && (
                  <div className="mm-field">
                    <label className="mm-field-label">Allergens</label>
                    <div className="mm-check-grid">
                      {allergens.map((a) => {
                        const checked = itemAllergenIds.includes(a.id);
                        return (
                          <div
                            key={a.id}
                            className={`mm-check-item ${checked ? "checked" : ""}`}
                            onClick={() => {
                              setItemAllergenIds((prev) =>
                                checked ? prev.filter((id) => id !== a.id) : [...prev, a.id]
                              );
                            }}
                          >
                            <div className="mm-checkbox">
                              {checked && <Check size={10} />}
                            </div>
                            {a.name_en || a.name || a.id}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Add-ons */}
                {addOns.length > 0 && (
                  <div className="mm-field">
                    <label className="mm-field-label">Add-ons</label>
                    <div className="mm-check-grid">
                      {addOns.map((a) => {
                        const checked = itemAddOnIds.includes(a.id);
                        return (
                          <div
                            key={a.id}
                            className={`mm-check-item ${checked ? "checked" : ""}`}
                            onClick={() => {
                              setItemAddOnIds((prev) =>
                                checked ? prev.filter((id) => id !== a.id) : [...prev, a.id]
                              );
                            }}
                          >
                            <div className="mm-checkbox">
                              {checked && <Check size={10} />}
                            </div>
                            {a.name_en || a.name || a.id}
                            {a.price != null && (
                              <span style={{ color: "#d7bc8a", marginLeft: "auto", fontSize: 11 }}>
                                +{a.price}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mm-editor-footer">
                <button className="mm-btn mm-btn-secondary" onClick={() => setEditorOpen(false)}>
                  Cancel
                </button>
                <button
                  className="mm-btn mm-btn-primary"
                  onClick={handleSaveItem}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={15} style={{ animation: "mm-spin 0.7s linear infinite" }} />
                  ) : (
                    <Check size={15} />
                  )}
                  {saving ? "Saving…" : editorMode === "create" ? "Create Item" : "Save Changes"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ═══ TOAST ═══ */}
      <AnimatePresence>
        {toast && (
          <Toast
            key={toast.message}
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>

      {/* ═══ CONFIRM DIALOG ═══ */}
      <AnimatePresence>
        {confirm && (
          <ConfirmDialog
            key="confirm"
            title={confirm.title}
            message={confirm.message}
            onConfirm={confirm.onConfirm}
            onCancel={() => setConfirm(null)}
            loading={confirmLoading}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {visibilityTarget && (
          <ItemVisibilityModal
            key={visibilityTarget.id}
            item={visibilityTarget}
            form={visibilityForm}
            setForm={setVisibilityForm}
            onConfirm={handleSaveVisibility}
            onCancel={() => setVisibilityTarget(null)}
            loading={visibilityLoading}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
