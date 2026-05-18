import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  EyeOff,
  Ban,
  Loader2,
  UtensilsCrossed,
  Package,
  LayoutGrid,
} from "lucide-react";
import {
  getCategories,
  
  updateMenuItem,
  createMenuItem,
  deleteMenuItem,
  toggleSoldOut,
  toggleItemActive,
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
  setItemAddons,
  setItemAllergens,
  uploadMenuImage,
  deleteMenuImage,
  duplicateMenuItem,
} from "../lib/menuApi";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import "./styles/menu-manager.css";

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

export default function MenuManager() {
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

  const loadCategories = useCallback(async () => {
    try {
      const res = await getCategories();
      const cats = Array.isArray(res?.data) ? res.data : [];
      setCategories(cats);
      return cats;
    } catch (e) {
      setError("Failed to load categories");
      return [];
    }
  }, []);

  const loadMenuForCategory = useCallback(async (catId) => {
    if (!catId || !supabase) return;
    setItemsLoading(true);
    try {
      const { data: sections, error: secErr } = await supabase
        .from("sections")
        .select("*")
        .eq("category_id", catId)
        .order("sort_order");
      if (secErr) throw secErr;

      const secIds = (sections || []).map((s) => s.id);
      let items = [];
      if (secIds.length > 0) {
        const { data: itemData } = await supabase
          .from("menu_items")
          .select("*")
          .in("section_id", secIds)
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
    } catch (e) {
      setError("Failed to load menu items");
    } finally {
      setItemsLoading(false);
    }
  }, []);

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
    if (!isSupabaseConfigured()) {
      setLoading(false);
      setError("Supabase is not configured. Add your keys to .env.local to use the Menu Manager.");
      return;
    }
    async function init() {
      setLoading(true);
      const cats = await loadCategories();
      await Promise.all([loadAddOns(), loadAllergens()]);
      if (cats.length > 0) {
        setSelectedCatId(cats[0].id);
        await loadMenuForCategory(cats[0].id);
      }
      setLoading(false);
    }
    init();
  }, [loadCategories, loadAddOns, loadAllergens, loadMenuForCategory]);

  useEffect(() => {
    if (selectedCatId) {
      loadMenuForCategory(selectedCatId);
    }
  }, [selectedCatId, loadMenuForCategory]);

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
            case "inactive": return !item.active;
            case "vegetarian": return item.vegetarian;
            case "new_item": return item.new_item;
            default: return true;
          }
        });
      }

      return { ...section, items };
    });
  }, [menuData, searchQuery, activeFilter]);

  const totalFilteredItems = useMemo(
    () => filteredSections.reduce((sum, s) => sum + s.items.length, 0),
    [filteredSections]
  );

  // ── Category CRUD ──

  const handleSelectCategory = useCallback((catId) => {
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
    if (!catEditData.name_en.trim()) return;
    try {
      if (catEditMode === "create") {
        await createCategory(catEditData);
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
  }, [catEditMode, catEditData, loadCategories, showToast, selectedCatId]);

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
    if (!name?.trim()) return;
    const nameAr = prompt("Section name (Arabic):") || "";
    try {
      await createSection({ name_en: name.trim(), name_ar: nameAr.trim(), category_id: selectedCatId, sort_order: menuData.length });
      showToast("Section created");
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to create section", "error");
    }
  }, [selectedCatId, menuData.length, showToast, loadMenuForCategory]);

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
    setEditorOpen(true);
  }, [selectedCatId]);

  const openEditItem = useCallback((item) => {
    setEditorMode("edit");
    setEditingItem({
      name_en: item.name_en || "",
      name_ar: item.name_ar || "",
      desc_en: item.desc_en || "",
      desc_ar: item.desc_ar || "",
      price: item.price ?? "",
      calories: item.calories ?? "",
      image: item.image || "",
      category_id: item.category_id || selectedCatId || "",
      section_id: item.section_id || "",
      sold_out: item.sold_out || false,
      featured: item.featured || false,
      new_item: item.new_item || false,
      vegetarian: item.vegetarian || false,
      vegan: item.vegan || false,
      active: item.active !== false,
    });
    setEditingItemId(item.id);
    setItemAllergenIds((item.allergens || []).map((a) => a.id || a));
    setItemAddOnIds((item.add_ons || []).map((a) => a.id || a));
    setImageFile(null);
    setImagePreview(item.image || "");
    setEditorOpen(true);
  }, [selectedCatId]);

  const handleSaveItem = useCallback(async () => {
    if (!editingItem.name_en.trim()) {
      showToast("Name (English) is required", "error");
      return;
    }
    setSaving(true);
    try {
      let imgUrl = editingItem.image;

      if (imageFile) {
        const uploaded = await uploadMenuImage(imageFile);
        if (uploaded?.url) imgUrl = uploaded.url;
      }

      const payload = {
        ...editingItem,
        image: imgUrl,
        price: editingItem.price || "",
        calories: editingItem.calories || "-",
      };

      let itemId = editingItemId;
      if (editorMode === "create") {
        const created = await createMenuItem(payload);
        itemId = created?.id || created;
        showToast("Item created");
      } else {
        await updateMenuItem(editingItemId, payload);
        showToast("Item updated");
      }

      if (itemId) {
        try { await setItemAllergens(itemId, itemAllergenIds); } catch (_) {}
        try { await setItemAddons(itemId, itemAddOnIds); } catch (_) {}
      }

      setEditorOpen(false);
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to save item", "error");
    } finally {
      setSaving(false);
    }
  }, [editingItem, editorMode, editingItemId, imageFile, itemAllergenIds, itemAddOnIds, showToast, loadMenuForCategory, selectedCatId]);

  const handleToggleSoldOut = useCallback(async (item) => {
    const newVal = !item.sold_out;
    setMenuData((prev) =>
      prev.map((s) => ({
        ...s,
        items: s.items.map((it) => it.id === item.id ? { ...it, sold_out: newVal } : it),
      }))
    );
    try {
      await toggleSoldOut(item.id, newVal);
    } catch (e) {
      showToast("Failed to update", "error");
      loadMenuForCategory(selectedCatId);
    }
  }, [showToast, loadMenuForCategory, selectedCatId]);

  const handleToggleActive = useCallback(async (item) => {
    const newVal = !item.active;
    setMenuData((prev) =>
      prev.map((s) => ({
        ...s,
        items: s.items.map((it) => it.id === item.id ? { ...it, active: newVal } : it),
      }))
    );
    try {
      await toggleItemActive(item.id, newVal);
    } catch (e) {
      showToast("Failed to update", "error");
      loadMenuForCategory(selectedCatId);
    }
  }, [showToast, loadMenuForCategory, selectedCatId]);

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

  const allSections = useMemo(() => {
    const result = [{ id: "", name_en: "No section" }];
    menuData.forEach((s) => result.push({ id: s.id, name_en: s.name_en }));
    return result;
  }, [menuData]);

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
            <motion.button
              key={cat.id}
              className={`mm-cat-item ${cat.id === selectedCatId ? "active" : ""} ${cat.active === false ? "mm-cat-item-inactive" : ""}`}
              onClick={() => handleSelectCategory(cat.id)}
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
            </motion.button>
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
                              {section.items.map((item, itemIdx) => (
                                <motion.div
                                  key={item.id}
                                  className={`mm-item-card ${!item.active ? "inactive" : ""}`}
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
                                    {item.sold_out && <span className="mm-badge mm-badge-sold-out">Sold Out</span>}
                                    {item.featured && <span className="mm-badge mm-badge-featured">Featured</span>}
                                    {item.new_item && <span className="mm-badge mm-badge-new">New</span>}
                                    {item.vegetarian && <span className="mm-badge mm-badge-veg">Veg</span>}
                                    {item.vegan && <span className="mm-badge mm-badge-vegan">Vegan</span>}
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
                                      className={`mm-item-action-btn ${item.active ? "active-toggle" : ""}`}
                                      onClick={() => handleToggleActive(item)}
                                      title={item.active ? "Deactivate" : "Activate"}
                                    >
                                      {item.active ? <Eye size={14} /> : <EyeOff size={14} />}
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
                              ))}

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

                {/* Category & Section */}
                <div className="mm-field-row">
                  <div className="mm-field">
                    <label className="mm-field-label">Category</label>
                    <select
                      className="mm-field-select"
                      value={editingItem.category_id}
                      onChange={(e) => setEditingItem((p) => ({ ...p, category_id: e.target.value }))}
                    >
                      <option value="">Select category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name_en || c.id}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mm-field">
                    <label className="mm-field-label">Section</label>
                    <select
                      className="mm-field-select"
                      value={editingItem.section_id}
                      onChange={(e) => setEditingItem((p) => ({ ...p, section_id: e.target.value }))}
                    >
                      {allSections.map((s) => (
                        <option key={s.id} value={s.id}>{s.name_en}</option>
                      ))}
                    </select>
                  </div>
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
    </div>
  );
}
