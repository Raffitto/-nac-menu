import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
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
  
  addExistingItemsToSection,
  fetchBranchMenuItemRows,
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
  fetchItemAddonIds,
  fetchItemAllergenIds,
  uploadMenuImage,
  deleteMenuImage,
  duplicateMenuItem,
  publishAndVerifyMenuBranch,
  getMenuPublishStatus,
  MENU_PUBLISH_STAGES,
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
  buildExtraPlacementsFromMembers,
  hydratePlacementCategoryIds,
  reorderPlacementRows,
} from "../lib/menuPlacements";
import MenuItemPlacementEditor from "./MenuItemPlacementEditor";
import MenuAddItemModal from "./MenuAddItemModal";
import MenuPublishStatusBar from "./MenuPublishStatusBar";
import MenuManagerTooltip from "./MenuManagerTooltip";
import {
  buildEditorSnapshot,
  formatRelativeTimestamp,
  friendlyPublishErrorMessage,
  isOnboardingDismissed,
  MENU_TOOLTIPS,
  resolvePublishBarState,
  snapshotsEqual,
} from "./menuManagerUx";
import { buildMenuItemCatalogue } from "../lib/menuSectionPlacement";
import { useRbac } from "./context/RbacContext";
import {
  resolveMenuEditorBranch,
  canEditMenuEngineering,
  assertMenuBranchAccess,
  canManageGlobalAddOns,
  lockBranchIdOnPayload,
} from "../lib/menuBranchScope";
import {
  branchDisplayOptions,
  publicMenuPathForBranch,
} from "./config/branchDisplayConfig";
import "./styles/menu-manager.css";

const MenuManagerOnboarding = lazy(() => import("./MenuManagerOnboarding"));

function toDatetimeLocalValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let placementRowSequence = 0;
function newPlacementRowKey(itemId = null) {
  if (itemId) return `saved-${itemId}`;
  placementRowSequence += 1;
  return `placement-${Date.now()}-${placementRowSequence}`;
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

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  loading,
  confirmLabel = "Delete",
  danger = true,
}) {
  return (
    <motion.div
      className="mm-confirm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
      role="presentation"
    >
      <motion.div
        className="mm-confirm-dialog"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="mm-confirm-title"
        aria-describedby="mm-confirm-message"
      >
        <h4 id="mm-confirm-title">{title}</h4>
        <p id="mm-confirm-message">{message}</p>
        <div className="mm-confirm-actions">
          <button className="mm-btn mm-btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            className={`mm-btn ${danger ? "mm-btn-danger" : "mm-btn-primary"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="mm-spin-icon" /> : null}
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ToggleSwitch({ value, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      className={`mm-toggle-switch ${value ? "on" : ""}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
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
  const showMenuBranchSelector = menuBranchOptions.length > 1;
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
  const [publishStage, setPublishStage] = useState(null);
  const [publishStatus, setPublishStatus] = useState(null);
  const [publishError, setPublishError] = useState("");
  const [retryPublish, setRetryPublish] = useState(null);
  const [publishInFlight, setPublishInFlight] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [editorBaseline, setEditorBaseline] = useState(null);

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
  const [placementGroupId, setPlacementGroupId] = useState(null);
  const [removedPlacementIds, setRemovedPlacementIds] = useState([]);
  const [addItemTarget, setAddItemTarget] = useState(null);
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [branchCatalogue, setBranchCatalogue] = useState([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [addItemSaving, setAddItemSaving] = useState(false);

  const sectionsCatalogRef = useRef([]);
  const categoriesRef = useRef([]);
  const lastLoadedCatRef = useRef(null);
  const menuLoadRequestRef = useRef(0);

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

  const editorDirty = useMemo(() => {
    if (!editorOpen || editorBaseline == null) return false;
    return !snapshotsEqual(
      editorBaseline,
      buildEditorSnapshot({
        editingItem,
        itemAllergenIds,
        itemAddOnIds,
        extraPlacements,
        imageFile,
        removedPlacementIds,
      }),
    );
  }, [
    editorOpen,
    editorBaseline,
    editingItem,
    itemAllergenIds,
    itemAddOnIds,
    extraPlacements,
    imageFile,
    removedPlacementIds,
  ]);

  const publishBarState = useMemo(
    () =>
      resolvePublishBarState({
        publishStage,
        publishStatus,
        retryPublish,
        publishInFlight,
      }),
    [publishStage, publishStatus, retryPublish, publishInFlight],
  );

  const friendlyPublishError = useMemo(
    () => (publishError ? friendlyPublishErrorMessage({ message: publishError }) : ""),
    [publishError],
  );

  const requestLeaveWithUnsavedCheck = useCallback(
    (onLeave) => {
      if (!editorDirty) {
        onLeave();
        return;
      }
      setConfirm({
        title: "Unsaved changes",
        message: "You have unsaved changes. Leave anyway?",
        confirmLabel: "Leave",
        danger: false,
        onConfirm: () => {
          setConfirm(null);
          onLeave();
        },
      });
    },
    [editorDirty],
  );

  const closeEditor = useCallback(() => {
    requestLeaveWithUnsavedCheck(() => {
      setEditorOpen(false);
      setEditorBaseline(null);
    });
  }, [requestLeaveWithUnsavedCheck]);

  const loadPublishStatus = useCallback(async () => {
    try {
      const { data, error: statusError } = await getMenuPublishStatus(menuBranch);
      if (statusError) throw statusError;
      setPublishStatus(data);
      return data;
    } catch {
      return null;
    }
  }, [menuBranch]);

  const publishCurrentMenu = useCallback(async (
    changeSummary,
    expected = null,
    key = null,
    options = {},
  ) => {
    const { silentToast = false } = options;
    const idempotencyKey =
      key ||
      `${menuBranch}:${changeSummary?.action || "publish"}:${
        window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
      }`;
    setPublishError("");
    setRetryPublish(null);
    setPublishInFlight(true);
    const result = await publishAndVerifyMenuBranch({
      branchId: menuBranch,
      changeSummary,
      expected,
      idempotencyKey,
      onStage: setPublishStage,
    });
    await loadPublishStatus();
    setPublishInFlight(false);
    if (result.error) {
      console.error("[MenuManager] publish failed:", result.error);
      setPublishError(result.error.message);
      setRetryPublish({ changeSummary, expected, idempotencyKey });
      throw result.error;
    }
    const publishedAt = Date.now();
    if (!silentToast) {
      setToast({
        message: `✓ Guest menu updated successfully. ${formatRelativeTimestamp(publishedAt, publishedAt)}`,
        type: "success",
      });
    }
    return result.data;
  }, [menuBranch, loadPublishStatus]);

  const handleManualPublish = useCallback(async () => {
    if (readOnlyMenu || publishInFlight) return;
    try {
      await publishCurrentMenu({
        action: "retry_publish",
        entity_type: "menu",
        entity_id: menuBranch,
      });
    } catch {
      /* friendly error shown in status bar */
    }
  }, [readOnlyMenu, publishInFlight, publishCurrentMenu, menuBranch]);

  const handleRetryPublish = useCallback(async () => {
    if (readOnlyMenu || publishInFlight) return;
    const pending = retryPublish || {
      changeSummary: {
        action: "retry_publish",
        entity_type: "menu",
        entity_id: menuBranch,
      },
      expected: null,
      idempotencyKey: null,
    };
    try {
      await publishCurrentMenu(
        pending.changeSummary,
        pending.expected,
        pending.idempotencyKey,
      );
    } catch {
      /* friendly error shown in status bar */
    }
  }, [readOnlyMenu, publishInFlight, retryPublish, publishCurrentMenu, menuBranch]);

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
    const requestId = ++menuLoadRequestRef.current;
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
        const { data: itemData, error: itemErr } = await supabase
          .from("menu_items")
          .select("*")
          .in("section_id", secIds)
          .eq("branch_id", menuBranch)
          .order("sort_order");
        if (itemErr) throw itemErr;
        items = itemData || [];
      }
      if (requestId !== menuLoadRequestRef.current) return;

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
      if (requestId === menuLoadRequestRef.current) {
        setError(e?.message || "Failed to load menu items");
      }
    } finally {
      if (requestId === menuLoadRequestRef.current) setItemsLoading(false);
    }
  }, [menuBranch]);

  const loadAddOns = useCallback(async () => {
    try {
      const res = await getAddOns({ includeInactive: true });
      if (res.error) throw res.error;
      setAddOns(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      showToast(e?.message || "Failed to load add-ons", "error");
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
      setError("Menu Manager is temporarily unavailable. Contact your NAC administrator.");
      return undefined;
    }

    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        const cats = await loadCategories();
        await Promise.all([loadSectionsCatalog(), loadAddOns(), loadAllergens()]);
        if (!cancelled) {
          const firstCategoryId = cats[0]?.id || null;
          setMenuData([]);
          setSelectedCatId(firstCategoryId);
          lastLoadedCatRef.current = firstCategoryId;
          if (firstCategoryId) await loadMenuForCategory(firstCategoryId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [
    menuBranch,
    loadCategories,
    loadSectionsCatalog,
    loadAddOns,
    loadAllergens,
    loadMenuForCategory,
  ]);

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

  useEffect(() => {
    if (!rbac.profile?.authenticated) return;
    loadPublishStatus();
  }, [rbac.profile?.authenticated, loadPublishStatus]);

  useEffect(() => {
    setShowOnboarding(!isOnboardingDismissed());
  }, []);

  useEffect(() => {
    if (!editorDirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editorDirty]);

  useEffect(() => {
    if (!editorOpen) return;
    setEditorBaseline(
      buildEditorSnapshot({
        editingItem,
        itemAllergenIds,
        itemAddOnIds,
        extraPlacements,
        imageFile,
        removedPlacementIds,
      }),
    );
    // Baseline captures the opened form state once per editor session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, editingItemId]);

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

  const totalMenuItems = useMemo(
    () => menuData.reduce((sum, s) => sum + (s.items?.length || 0), 0),
    [menuData],
  );

  const showSearchEmpty = Boolean(
    selectedCatId &&
      !itemsLoading &&
      searchQuery.trim() &&
      totalFilteredItems === 0 &&
      totalMenuItems > 0,
  );

  // ── Category CRUD ──

  const handleSelectCategory = useCallback((catId) => {
    const applySelection = () => {
      if (catId === selectedCatId) {
        loadMenuForCategory(catId);
      }
      lastLoadedCatRef.current = null;
      setSelectedCatId(catId);
      setSearchQuery("");
      setActiveFilter("all");
    };
    if (editorOpen && editorDirty) {
      requestLeaveWithUnsavedCheck(() => {
        setEditorOpen(false);
        setEditorBaseline(null);
        applySelection();
      });
      return;
    }
    applySelection();
  }, [selectedCatId, loadMenuForCategory, editorOpen, editorDirty, requestLeaveWithUnsavedCheck]);

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
      const payload = lockBranchIdOnPayload(
        { ...catEditData, branch_id: menuBranch },
        menuBranch,
        rbac.profile,
      );
      if (catEditMode === "create") {
        const created = assertMenuMutation(await createCategory(payload), "createCategory");
        await publishCurrentMenu({
          action: "create_category",
          entity_type: "category",
          entity_id: created.id,
          changed_fields: payload,
        });
        showToast("Category created and verified live");
      } else {
        assertMenuMutation(await updateCategory(catEditData.id, catEditData), "updateCategory");
        await publishCurrentMenu({
          action: "update_category",
          entity_type: "category",
          entity_id: catEditData.id,
          changed_fields: catEditData,
        });
        showToast("Category updated and verified live");
      }
      setCatEditMode(null);
      const cats = await loadCategories();
      if (!selectedCatId && cats.length > 0) {
        setSelectedCatId(cats[0].id);
      }
    } catch (e) {
      showToast(e?.message || "Failed to save category", "error");
    }
  }, [catEditMode, catEditData, loadCategories, showToast, selectedCatId, readOnlyMenu, rbac.profile, menuBranch, publishCurrentMenu]);

  const handleDeleteCategory = useCallback((cat, e) => {
    e.stopPropagation();
    setConfirm({
      title: "Delete Category",
      message: `Delete "${cat.name_en}"? All sections and items within will also be removed.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          assertMenuMutation(await deleteCategory(cat.id), "deleteCategory");
          await publishCurrentMenu({
            action: "delete_category",
            entity_type: "category",
            entity_id: cat.id,
            changed_fields: { name_en: cat.name_en },
          });
          showToast("Category deleted and verified live");
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
  }, [loadCategories, showToast, selectedCatId, publishCurrentMenu]);

  const handleReorderCategory = useCallback(async (index, direction) => {
    const newCats = [...categories];
    const swapIdx = index + direction;
    if (swapIdx < 0 || swapIdx >= newCats.length) return;
    [newCats[index], newCats[swapIdx]] = [newCats[swapIdx], newCats[index]];
    setCategories(newCats);
    try {
      const ordered = newCats.map((c, i) => ({ id: c.id, sort_order: i }));
      for (const item of ordered) {
        assertMenuMutation(
          await updateCategory(item.id, { sort_order: item.sort_order }),
          "reorderCategory",
        );
      }
      await publishCurrentMenu({
        action: "reorder_categories",
        entity_type: "category",
        changed_fields: { order: ordered },
      });
    } catch (e) {
      showToast("Failed to reorder", "error");
      loadCategories();
    }
  }, [categories, loadCategories, showToast, publishCurrentMenu]);

  // ── Section CRUD ──

  const handleAddSection = useCallback(async () => {
    if (!selectedCatId) return;
    const name = prompt("Section name (English):");
    if (!name?.trim() || readOnlyMenu) return;
    const nameAr = prompt("Section name (Arabic):") || "";
    try {
      assertMenuBranchAccess(rbac.profile, menuBranch);
      const created = assertMenuMutation(await createSection({
        name_en: name.trim(),
        name_ar: nameAr.trim(),
        category_id: selectedCatId,
        sort_order: menuData.length,
        branch_id: menuBranch,
      }), "createSection");
      await publishCurrentMenu({
        action: "create_section",
        entity_type: "section",
        entity_id: created.id,
        changed_fields: { name_en: name.trim(), category_id: selectedCatId },
      });
      showToast("Section created and verified live");
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to create section", "error");
    }
  }, [selectedCatId, menuData.length, showToast, loadMenuForCategory, readOnlyMenu, rbac.profile, menuBranch, publishCurrentMenu]);

  const handleSaveSection = useCallback(async (sectionId) => {
    try {
      assertMenuMutation(await updateSection(sectionId, sectionEditData), "updateSection");
      await publishCurrentMenu({
        action: "update_section",
        entity_type: "section",
        entity_id: sectionId,
        changed_fields: sectionEditData,
      });
      showToast("Section updated and verified live");
      setSectionEditId(null);
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to update section", "error");
    }
  }, [sectionEditData, showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

  const handleDeleteSection = useCallback((section) => {
    setConfirm({
      title: "Delete Section",
      message: `Delete "${section.name_en}"? All items in this section will be removed.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          assertMenuMutation(await deleteSection(section.id), "deleteSection");
          await publishCurrentMenu({
            action: "delete_section",
            entity_type: "section",
            entity_id: section.id,
            changed_fields: { name_en: section.name_en },
          });
          showToast("Section deleted and verified live");
          loadMenuForCategory(selectedCatId);
        } catch (e) {
          showToast(e?.message || "Failed to delete section", "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

  const handleReorderSection = useCallback(async (index, direction) => {
    const newSections = [...menuData];
    const swapIdx = index + direction;
    if (swapIdx < 0 || swapIdx >= newSections.length) return;
    [newSections[index], newSections[swapIdx]] = [newSections[swapIdx], newSections[index]];
    setMenuData(newSections);
    try {
      const ordered = newSections.map((s, i) => ({ id: s.id, sort_order: i }));
      assertMenuMutation(await reorderSections(ordered), "reorderSections");
      await publishCurrentMenu({
        action: "reorder_sections",
        entity_type: "section",
        changed_fields: { order: ordered },
      });
    } catch (e) {
      showToast("Failed to reorder sections", "error");
      loadMenuForCategory(selectedCatId);
    }
  }, [menuData, showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

  // ── Item CRUD ──

  const resetPlacementEditor = useCallback(() => {
    setExtraPlacements([]);
    setPlacementGroupId(null);
    setRemovedPlacementIds([]);
  }, []);

  const openCreateItem = useCallback((sectionId, categoryId = selectedCatId) => {
    setEditorMode("create");
    setEditingItem({
      ...EMPTY_ITEM,
      category_id: categoryId || "",
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

  const openAddItemChooser = useCallback((section) => {
    if (readOnlyMenu) {
      showToast("Read-only menu access", "error");
      return;
    }
    const category = categories.find((cat) => cat.id === selectedCatId);
    setAddItemTarget({
      sectionId: section.id,
      sectionName: section.name_en || section.name || "Section",
      categoryId: selectedCatId,
      categoryName: category?.name_en || category?.slug || "Menu",
    });
    setBranchCatalogue([]);
    setAddItemModalOpen(true);
  }, [categories, readOnlyMenu, selectedCatId, showToast]);

  const loadBranchCatalogue = useCallback(async () => {
    setCatalogueLoading(true);
    try {
      assertMenuBranchAccess(rbac.profile, menuBranch);
      const { data: rows, error } = await fetchBranchMenuItemRows(menuBranch);
      if (error) throw error;
      setBranchCatalogue(
        buildMenuItemCatalogue(rows || [], sectionsCatalog, categories),
      );
    } catch (e) {
      showToast(e?.message || "Failed to load menu catalogue", "error");
      setBranchCatalogue([]);
    } finally {
      setCatalogueLoading(false);
    }
  }, [categories, menuBranch, rbac.profile, sectionsCatalog, showToast]);

  const handleConfirmAddExistingItems = useCallback(async (selectedEntries) => {
    if (!addItemTarget?.sectionId || !selectedEntries.length) return;
    setAddItemSaving(true);
    setPublishStage(MENU_PUBLISH_STAGES.SAVING);
    try {
      assertMenuBranchAccess(rbac.profile, menuBranch);
      const itemRows = selectedEntries.map((entry) => entry.row);
      const { data: added, error } = await addExistingItemsToSection({
        items: itemRows,
        destinationSectionId: addItemTarget.sectionId,
      });
      if (error) throw error;
      if (!added.length) {
        throw new Error("No items were added to this section.");
      }

      await publishCurrentMenu(
        {
          action: "add_placement",
          entity_type: "menu_section",
          entity_id: addItemTarget.sectionId,
          changed_fields: {
            section_id: addItemTarget.sectionId,
            item_ids: added.map((item) => item.id),
          },
        },
        added[0]
          ? {
              type: "item",
              itemId: added[added.length - 1].id,
              present: true,
              fields: { en: added[added.length - 1].name_en },
            }
          : null,
      );

      showToast(
        added.length > 1
          ? `${added.length} items added to ${addItemTarget.sectionName} — verified live`
          : `${added[0].name_en} added to ${addItemTarget.sectionName} — verified live`,
      );
      setAddItemModalOpen(false);
      setAddItemTarget(null);
      setBranchCatalogue([]);
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      setPublishStage(MENU_PUBLISH_STAGES.FAILED);
      showToast(e?.message || "Failed to add items", "error");
      await loadMenuForCategory(selectedCatId);
    } finally {
      setAddItemSaving(false);
    }
  }, [
    addItemTarget,
    loadMenuForCategory,
    menuBranch,
    publishCurrentMenu,
    rbac.profile,
    selectedCatId,
    showToast,
  ]);

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

    let linkedAddonIds = [];
    let linkedAllergenIds = [];
    try {
      [linkedAddonIds, linkedAllergenIds] = await Promise.all([
        fetchItemAddonIds(item.id),
        fetchItemAllergenIds(item.id),
      ]);
    } catch {
      linkedAddonIds = (item.add_ons || []).map((a) => a.id || a);
      linkedAllergenIds = (item.allergens || []).map((a) => a.id || a);
    }
    setItemAllergenIds(linkedAllergenIds);
    setItemAddOnIds(linkedAddonIds);
    setImageFile(null);
    setImagePreview(item.image || "");
    setRemovedPlacementIds([]);

    const groupId = item.placement_group_id || null;
    setPlacementGroupId(groupId);

    if (groupId) {
      const { data: members } = await fetchPlacementGroupMembers(groupId);
      const extras = hydratePlacementCategoryIds(
        buildExtraPlacementsFromMembers(
          members,
          item.id,
          sectionsCatalog,
          newPlacementRowKey,
        ),
        sectionsCatalog,
      );
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
    setPublishStage(MENU_PUBLISH_STAGES.SAVING);
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
      const placementCheck = validatePlacements(
        primaryPlacement,
        extraPlacements,
        sectionsCatalog,
      );
      if (!placementCheck.ok) {
        showToast(placementCheck.message, "error");
        return;
      }

      const contentPayload = lockBranchIdOnPayload(
        sanitizeMenuItemPayload({
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
        }),
        menuBranch,
        rbac.profile,
      );

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
      } else {
        const isLinked = Boolean(placementGroupId || extraPlacements.length > 0);
        await updateMenuItemPlacements({
          itemId: editingItemId,
          contentPayload,
          primarySectionId: primaryPlacement.section_id,
          extraPlacements: extraPlacements.map((p) => ({
            itemId: p.itemId || null,
            sectionId: p.section_id,
          })),
          removePlacementItemIds: removedPlacementIds,
          syncLinked: isLinked,
          placementGroupId,
          allergenIds: itemAllergenIds,
          addonIds: itemAddOnIds,
        });
      }

      const { data: verified, error: verifyErr } = await fetchMenuItemById(itemId);
      if (verifyErr) throw verifyErr;
      if (verified.sold_out !== contentPayload.sold_out) {
        throw new Error("Sold out did not persist — check Supabase column and permissions");
      }

      const allergenCodes = itemAllergenIds
        .map((id) => allergens.find((a) => a.id === id)?.code)
        .filter(Boolean);
      const publishedAt = Date.now();
      await publishCurrentMenu(
        {
          action: editorMode === "create" ? "create_item" : "update_item",
          entity_type: "menu_item",
          entity_id: itemId,
          changed_fields: {
            name_en: contentPayload.name_en,
            description: contentPayload.desc_en,
            price: contentPayload.price,
            calories: contentPayload.calories,
            active: contentPayload.active,
            sold_out: contentPayload.sold_out,
            featured: contentPayload.featured,
            allergens: allergenCodes,
          },
        },
        {
          type: "item",
          itemId,
          present: contentPayload.active !== false,
          fields: contentPayload.active !== false
            ? {
                en: contentPayload.name_en,
                descEn: contentPayload.desc_en,
                price: contentPayload.price,
                calories: contentPayload.calories,
                soldOut: contentPayload.sold_out,
                featured: contentPayload.featured,
              }
            : {},
          allergens: contentPayload.active !== false ? allergenCodes : undefined,
        },
        null,
        { silentToast: true },
      );
      setToast({
        message: `✓ Menu item saved. Guest menu updated successfully. ${formatRelativeTimestamp(publishedAt, publishedAt)}`,
        type: "success",
      });

      setEditorOpen(false);
      setEditorBaseline(null);
      resetPlacementEditor();
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      setPublishStage(MENU_PUBLISH_STAGES.FAILED);
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
    placementGroupId,
    removedPlacementIds,
    showToast,
    loadMenuForCategory,
    selectedCatId,
    resetPlacementEditor,
    menuBranch,
    rbac.profile,
    readOnlyMenu,
    allergens,
    sectionsCatalog,
    publishCurrentMenu,
  ]);

  const handleToggleSoldOut = useCallback(async (item) => {
    const newVal = !item.sold_out;
    try {
      assertMenuMutation(await toggleSoldOut(item.id, newVal), "toggleSoldOut");
      const { data: verified } = await fetchMenuItemById(item.id);
      if (verified && Boolean(verified.sold_out) !== newVal) {
        throw new Error("Sold out did not persist");
      }
      await publishCurrentMenu(
        {
          action: "update_availability",
          entity_type: "menu_item",
          entity_id: item.id,
          changed_fields: { sold_out: newVal },
        },
        {
          type: "item",
          itemId: item.id,
          present: item.active !== false,
          fields: { soldOut: newVal },
        },
      );
      showToast(newVal ? "Marked sold out — verified live" : "Marked available — verified live");
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to update sold out", "error");
      await loadMenuForCategory(selectedCatId);
    }
  }, [showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

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
      await publishCurrentMenu(
        {
          action: "update_visibility",
          entity_type: "menu_item",
          entity_id: visibilityTarget.id,
          changed_fields: patch,
        },
        {
          type: "item",
          itemId: visibilityTarget.id,
          present: visibilityForm.mode === "active",
          fields: visibilityForm.mode === "active" ? { soldOut: patch.sold_out } : {},
        },
      );
      setVisibilityTarget(null);
      showToast("Visibility saved and verified live");
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to save visibility", "error");
      await loadMenuForCategory(selectedCatId);
    } finally {
      setVisibilityLoading(false);
    }
  }, [visibilityTarget, visibilityForm, showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

  const handleDuplicateItem = useCallback(async (item, e) => {
    e.stopPropagation();
    try {
      const duplicated = assertMenuMutation(await duplicateMenuItem(item.id), "duplicateMenuItem");
      await publishCurrentMenu(
        {
          action: "duplicate_item",
          entity_type: "menu_item",
          entity_id: duplicated.id,
          changed_fields: { source_item_id: item.id },
        },
        { type: "item", itemId: duplicated.id, present: duplicated.active !== false },
      );
      showToast("Item duplicated and verified live");
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to duplicate", "error");
    }
  }, [showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

  const handleDeleteItem = useCallback((item, e) => {
    e.stopPropagation();
    setConfirm({
      title: "Delete menu item?",
      message:
        "This removes it from the menu. Linked placements will also be removed.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          assertMenuMutation(await deleteMenuItem(item.id), "deleteMenuItem");
          await publishCurrentMenu(
            {
              action: "delete_item",
              entity_type: "menu_item",
              entity_id: item.id,
              changed_fields: { name_en: item.name_en },
            },
            { type: "item", itemId: item.id, present: false },
          );
          showToast("Item deleted and verified live");
          loadMenuForCategory(selectedCatId);
        } catch (e) {
          showToast(e?.message || "Failed to delete item", "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

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
      assertMenuMutation(await reorderItems(ordered), "reorderItems");
      await publishCurrentMenu({
        action: "reorder_items",
        entity_type: "menu_item",
        changed_fields: { order: ordered },
      });
    } catch (e) {
      showToast("Failed to reorder", "error");
      loadMenuForCategory(selectedCatId);
    }
  }, [menuData, showToast, loadMenuForCategory, selectedCatId, publishCurrentMenu]);

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
    if (!addonEditId && !canManageGlobalAddOns(rbac.profile)) {
      showToast(
        "Only network admins can create new global add-ons. You can link existing add-ons on menu items.",
        "error",
      );
      return;
    }
    setAddonSaving(true);
    try {
      const saved = assertMenuMutation(
        addonEditId
          ? await updateAddOn(addonEditId, addonFormData)
          : await createAddOn(addonFormData),
        addonEditId ? "updateAddOn" : "createAddOn",
      );
      setAddOns((prev) => {
        const next = addonEditId
          ? prev.map((a) => (a.id === saved.id ? saved : a))
          : [...prev, saved];
        return next.sort((a, b) =>
          String(a.slug || a.name_en).localeCompare(String(b.slug || b.name_en)),
        );
      });
      showToast(addonEditId ? "Add-on updated" : "Add-on created");
      setAddonFormOpen(false);
      setAddonEditId(null);
      setAddonFormData({ name_en: "", name_ar: "", price: "" });
      await loadAddOns();
    } catch (e) {
      showToast(e?.message || "Failed to save add-on", "error");
    } finally {
      setAddonSaving(false);
    }
  }, [addonFormData, addonEditId, showToast, loadAddOns, rbac.profile]);

  const handleDeleteAddOn = useCallback((addon) => {
    setConfirm({
      title: "Delete Add-on",
      message: `Delete "${addon.name_en}"? Items using this add-on will be unlinked.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          assertMenuMutation(await deleteAddOn(addon.id), "deleteAddOn");
          setAddOns((prev) => prev.filter((a) => a.id !== addon.id));
          showToast("Add-on deleted");
          await loadAddOns();
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

  const moveExtraPlacement = useCallback((fromIndex, toIndex) => {
    setExtraPlacements((prev) => reorderPlacementRows(prev, fromIndex, toIndex));
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

  const liveMenuBase =
    process.env.REACT_APP_PUBLIC_MENU_URL || "https://nacmenu.netlify.app";
  const liveMenuUrl = `${liveMenuBase.replace(/\/$/, "")}${publicMenuPathForBranch(menuBranch)}`;

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
      <div className="mm-top-shell">
        <MenuPublishStatusBar
          state={publishBarState}
          friendlyError={friendlyPublishError}
          publishing={publishInFlight}
          onPublish={handleManualPublish}
          onRetry={handleRetryPublish}
          liveMenuUrl={liveMenuUrl}
          readOnly={readOnlyMenu}
        />

        {showOnboarding ? (
          <Suspense fallback={null}>
            <MenuManagerOnboarding onDismiss={() => setShowOnboarding(false)} />
          </Suspense>
        ) : null}

        <div className="mm-branch-row">
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            Branch
            {showMenuBranchSelector ? (
              <select
                value={menuBranch}
                disabled={!rbac.canAccessAllBranches()}
                onChange={(e) => {
                  try {
                    assertMenuBranchAccess(rbac.profile, e.target.value);
                    setMenuBranch(e.target.value);
                  } catch (err) {
                    showToast(err?.message || "Branch access denied", "error");
                  }
                }}
                aria-label="Select branch"
              >
                {menuBranchOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <strong>{branchDisplayOptions("dashboardName").find((o) => o.value === menuBranch)?.label || menuBranch}</strong>
            )}
          </label>
          {readOnlyMenu ? (
            <span style={{ fontSize: "0.75rem", opacity: 0.75 }}>Read-only menu view</span>
          ) : null}
        </div>
      </div>
      <div className="mm-bg-glow" />
      <div className="mm-body">

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
                <Search size={16} aria-hidden="true" />
                <input
                  className="mm-search-input"
                  placeholder="Search items…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search menu items"
                />
              </div>
              <div className="mm-filter-pills">
                {FILTER_OPTIONS.map((f) => (
                  <button
                    key={f.key}
                    className={`mm-filter-pill ${activeFilter === f.key ? "active" : ""}`}
                    onClick={() => setActiveFilter(f.key)}
                    aria-pressed={activeFilter === f.key}
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

              {selectedCatId && !itemsLoading && showSearchEmpty && (
                <div className="mm-search-empty" data-testid="menu-search-empty">
                  <span>No matching menu items.</span>
                  <button
                    type="button"
                    className="mm-btn mm-btn-secondary"
                    style={{ padding: "4px 12px", fontSize: 12 }}
                    onClick={() => setSearchQuery("")}
                    data-testid="clear-menu-search"
                  >
                    Clear search
                  </button>
                </div>
              )}

              {selectedCatId && !itemsLoading && (
                <>
                  {filteredSections.map((section, sectionIdx) => {
                    const rawSection = menuData.find((s) => s.id === section.id);
                    const isSectionEmpty = (rawSection?.items || []).length === 0;
                    return (
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
                              {isSectionEmpty ? (
                                <div className="mm-section-empty" data-testid="section-empty-state">
                                  <span>No menu items in this section yet.</span>
                                  <div className="mm-section-empty-actions">
                                    <MenuManagerTooltip label={MENU_TOOLTIPS.addExistingItem}>
                                      <button
                                        type="button"
                                        className="mm-btn mm-btn-secondary"
                                        style={{ padding: "6px 12px", fontSize: 12 }}
                                        onClick={() => openAddItemChooser(section)}
                                        data-testid="section-add-existing"
                                      >
                                        Add Existing Item
                                      </button>
                                    </MenuManagerTooltip>
                                    <MenuManagerTooltip label={MENU_TOOLTIPS.createNewItem}>
                                      <button
                                        type="button"
                                        className="mm-btn mm-btn-primary"
                                        style={{ padding: "6px 12px", fontSize: 12 }}
                                        onClick={() => openCreateItem(section.id, selectedCatId)}
                                        data-testid="section-create-new"
                                      >
                                        Create New Item
                                      </button>
                                    </MenuManagerTooltip>
                                  </div>
                                </div>
                              ) : (
                                <>
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
                                    {item.featured && (
                                      <span className="mm-badge mm-badge-featured">Highlighted</span>
                                    )}
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

                              <MenuManagerTooltip label={MENU_TOOLTIPS.addItem}>
                                <div
                                  className="mm-add-item-card"
                                  onClick={() => openAddItemChooser(section)}
                                  role="button"
                                  tabIndex={0}
                                  aria-label="Add item to this section"
                                  data-testid="section-add-item-card"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      openAddItemChooser(section);
                                    }
                                  }}
                                >
                                  <Plus size={22} aria-hidden="true" />
                                  Add item
                                </div>
                              </MenuManagerTooltip>
                                </>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    );
                  })}

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
                {canManageGlobalAddOns(rbac.profile) ? (
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
                ) : null}
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
      </div>

      {/* ═══ EDITOR PANEL ═══ */}
      <AnimatePresence>
        {editorOpen && (
          <>
            <motion.div
              className="mm-editor-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeEditor}
            />
            <motion.div
              className="mm-editor"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              role="dialog"
              aria-modal="true"
              aria-label={editorMode === "create" ? "Create menu item" : "Edit menu item"}
            >
              <div className="mm-editor-header">
                <div>
                  <h3>{editorMode === "create" ? "New Item" : "Edit Item"}</h3>
                  {editorDirty ? (
                    <span className="mm-unsaved-indicator" data-testid="unsaved-changes-indicator">
                      <span className="mm-unsaved-dot" aria-hidden="true" />
                      Unsaved changes
                    </span>
                  ) : null}
                </div>
                <button
                  className="mm-editor-close"
                  onClick={closeEditor}
                  aria-label="Close editor"
                >
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
                <MenuItemPlacementEditor
                  categories={categories}
                  sectionsCatalog={sectionsCatalog}
                  primaryCategoryId={editingItem.category_id}
                  primarySectionId={editingItem.section_id}
                  onPrimaryChange={(patch) =>
                    setEditingItem((prev) => ({ ...prev, ...patch }))
                  }
                  extraPlacements={extraPlacements}
                  onExtraPlacementsChange={setExtraPlacements}
                  onRemoveExtraPlacement={removeExtraPlacement}
                  onMoveExtraPlacement={moveExtraPlacement}
                  createRowKey={newPlacementRowKey}
                />

                {editorMode === "edit" && (placementGroupId || extraPlacements.length > 0) && (
                  <p className="mm-linked-sync-note">
                    Linked item — name, description, price, image, tags, allergens, add-ons,
                    sold out, and active status stay in sync across all placements.
                  </p>
                )}

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
                      <MenuManagerTooltip label={MENU_TOOLTIPS.highlightGuest}>
                        <span className="mm-toggle-label">Highlight on Guest Menu</span>
                      </MenuManagerTooltip>
                      <ToggleSwitch
                        value={editingItem.featured}
                        onChange={(v) => setEditingItem((p) => ({ ...p, featured: v }))}
                        ariaLabel="Highlight on guest menu"
                      />
                    </div>
                    {editingItem.featured ? (
                      <span className="mm-recommended-badge" data-testid="recommended-preview-badge">
                        <span className="mm-recommended-badge-dot" aria-hidden="true" />
                        Appears in Recommended
                      </span>
                    ) : null}
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
                <button className="mm-btn mm-btn-secondary" onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  className={`mm-btn mm-btn-primary${editorDirty ? " mm-btn-emphasis" : ""}`}
                  onClick={handleSaveItem}
                  disabled={saving}
                  aria-label={editorMode === "create" ? "Create menu item" : "Save menu item changes"}
                  data-testid="save-menu-item-button"
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
            confirmLabel={confirm.confirmLabel}
            danger={confirm.danger}
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

      <AnimatePresence>
        {addItemModalOpen && addItemTarget && (
          <MenuAddItemModal
            key={`${addItemTarget.sectionId}-add-item`}
            open={addItemModalOpen}
            destination={addItemTarget}
            catalogue={branchCatalogue}
            loading={catalogueLoading}
            saving={addItemSaving}
            onClose={() => {
              if (addItemSaving) return;
              setAddItemModalOpen(false);
              setAddItemTarget(null);
              setBranchCatalogue([]);
            }}
            onOpenExisting={loadBranchCatalogue}
            onChooseCreateNew={() =>
              openCreateItem(addItemTarget.sectionId, addItemTarget.categoryId)
            }
            onConfirmExisting={handleConfirmAddExistingItems}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
