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
  ChevronLeft,
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
  moveMenuItemToSection,
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
import { itemPublishBadge } from "../lib/menuPublishDiff";
import useMenuPublishIntelligence from "./hooks/useMenuPublishIntelligence";
import MenuPublishDiffSheet from "./menuPublish/MenuPublishDiffSheet";
import MenuPublishPreviewPanel from "./menuPublish/MenuPublishPreviewPanel";
import MenuVersionHistorySheet from "./menuPublish/MenuVersionHistorySheet";
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
  MenuManagerDndProvider,
  SortableItemGrid,
  SectionFrame,
  ItemFrame,
  isolateInteractivePointer,
} from "./MenuManagerDnd";
import useMenuSelection from "./menuInteraction/useMenuSelection";
import useMenuUndo from "./menuInteraction/useMenuUndo";
import MenuCommandDock from "./menuInteraction/MenuCommandDock";
import MenuContextMenu from "./menuInteraction/MenuContextMenu";
import MenuQuickLook from "./menuInteraction/MenuQuickLook";
import MenuCommandPalette from "./menuInteraction/MenuCommandPalette";
import MenuLassoLayer from "./menuInteraction/MenuLassoLayer";
import MenuMoveToSheet from "./menuInteraction/MenuMoveToSheet";
import { isApplePlatform, isEditableTarget, isModKey } from "../lib/menuInteraction/platform";
import { moveSelectedGroup, shouldConfirmBulk } from "../lib/menuInteraction/groupOrdering";
import { diffBoardPlacements } from "../lib/menuInteraction/boardDiff";
import { flattenVisibleItems } from "../lib/menuInteraction/selectionModel";
import { summarizeSelectionAggregates } from "../lib/menuInteraction/selectionAggregates";
import {
  SIDEBAR_EVENTS,
  SIDEBAR_KEYS,
  emitSidebarToggle,
  writeSidebarCollapsed,
} from "../lib/sidebarPrefs";
import useCollapsibleSidebar from "./hooks/useCollapsibleSidebar";
import useCoarsePointer from "./hooks/useCoarsePointer";
import {
  buildEditorSnapshot,
  formatRelativeTimestamp,
  friendlyPublishErrorMessage,
  friendlyActionErrorMessage,
  guestMenuSuccessMessage,
  formatLastPublishedLabel,
  isOnboardingDismissed,
  MENU_TOOLTIPS,
  resolvePublishBarState,
  snapshotsEqual,
} from "./menuManagerUx";
import { buildMenuItemCatalogue } from "../lib/menuSectionPlacement";
import {
  buildItemOrderUpdates,
  buildSectionOrderUpdates,
  canMoveItemToSection,
  cloneSections,
  findItemLocation,
  moveItemBetweenSections,
  parseItemDndId,
  parseSectionDndId,
  reorderSectionsById,
  resolveItemDropTarget,
} from "../lib/menuManagerOrdering";
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

const MENU_CATALOGUE_SELECT = [
  "id",
  "name_en",
  "name_ar",
  "price",
  "calories",
  "image",
  "active",
  "section_id",
  "sort_order",
  "sold_out",
  "featured",
  "new_item",
  "vegetarian",
  "vegan",
  "hidden_until",
  "placement_group_id",
].join(",");

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
  { key: "inactive", label: "Hidden" },
  { key: "vegetarian", label: "Vegetarian" },
  { key: "new_item", label: "New" }];

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
            <span>Visible on guest menu</span>
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
  const dragSnapshotRef = useRef(null);
  const collapseExpandTimerRef = useRef(null);
  const [activeDragLabel, setActiveDragLabel] = useState(null);
  const [activeDragCount, setActiveDragCount] = useState(1);
  const [orderStatus, setOrderStatus] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const coarsePointer = useCoarsePointer();
  const [publishDiffOpen, setPublishDiffOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState("draft");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [quickLookItemId, setQuickLookItemId] = useState(null);
  const [moveSheetOpen, setMoveSheetOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const {
    collapsed: menuSidebarCollapsed,
    toggle: toggleMenuSidebar,
    expand: expandMenuSidebar,
  } = useCollapsibleSidebar(SIDEBAR_KEYS.menu, {
    toggleEvent: SIDEBAR_EVENTS.menuToggle,
  });
  const boardScrollRef = useRef(null);
  const showToastRef = useRef(null);

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
  const [sectionCreateOpen, setSectionCreateOpen] = useState(false);
  const [sectionCreateData, setSectionCreateData] = useState({ name_en: "", name_ar: "" });
  const [sectionCreateSaving, setSectionCreateSaving] = useState(false);

  // Add-on editor
  const [addonFormOpen, setAddonFormOpen] = useState(false);
  const [addonEditId, setAddonEditId] = useState(null);
  const [addonFormData, setAddonFormData] = useState({ name_en: "", name_ar: "", price: "" });
  const [addonSaving, setAddonSaving] = useState(false);

  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
  }, []);
  showToastRef.current = showToast;
  const selectionApi = useMenuSelection();
  const undoApi = useMenuUndo({
    onToast: (message, type = "success") => showToastRef.current?.(message, type),
  });

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
    removedPlacementIds]);

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

  const publishIntel = useMenuPublishIntelligence({
    branchId: menuBranch,
    enabled: !loading,
    publishStatus,
  });
  const refreshPublishIntel = publishIntel.refresh;
  const publishDiff = publishIntel.diff;

  const noteDraftChanged = useCallback(async () => {
    setPublishStage(null);
    setPublishError("");
    await loadPublishStatus();
    await refreshPublishIntel();
  }, [loadPublishStatus, refreshPublishIntel]);

  const publishBarState = useMemo(() => {
    const base = resolvePublishBarState({
      publishStage,
      publishStatus,
      retryPublish,
      publishInFlight,
    });
    if (base === "live" && publishDiff?.hasChanges) return "waiting";
    return base;
  }, [
    publishStage,
    publishStatus,
    retryPublish,
    publishInFlight,
    publishDiff?.hasChanges]);

  const handleManualPublish = useCallback(async () => {
    if (readOnlyMenu || publishInFlight) return;
    await refreshPublishIntel();
    setPublishDiffOpen(true);
  }, [readOnlyMenu, publishInFlight, refreshPublishIntel]);

  const confirmPublishFromDiff = useCallback(async () => {
    if (readOnlyMenu || publishInFlight) return;
    try {
      const summary = {
        action: "manual_publish",
        entity_type: "menu",
        entity_id: menuBranch,
        changed_fields: {
          change_count: publishDiff?.counts?.total || 0,
          categories: publishDiff?.counts || {},
        },
      };
      const data = await publishCurrentMenu(summary);
      setPublishDiffOpen(false);
      await refreshPublishIntel();
      if (data?.version != null) {
        showToast(`Version ${data.version} published`, "success");
      }
    } catch {
      /* friendly error shown in status bar */
    }
  }, [readOnlyMenu, publishInFlight, publishCurrentMenu, menuBranch, publishDiff, refreshPublishIntel, showToast]);

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
        .select("id, name_en, name_ar, category_id, sort_order, branch_id")
        .eq("category_id", catId)
        .eq("branch_id", menuBranch)
        .order("sort_order");
      if (secErr) throw secErr;

      const secIds = (sections || []).map((s) => s.id);
      let items = [];
      if (secIds.length > 0) {
        const { data: itemData, error: itemErr } = await supabase
          .from("menu_items")
          .select(MENU_CATALOGUE_SELECT)
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
        ...new Set(flatItems.map((it) => it.placement_group_id).filter(Boolean))];
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
    loadMenuForCategory]);

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

  useEffect(() => {
    if (!editorOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeEditor();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorOpen, closeEditor]);

  // ── Filtering ──

  const filteredSections = useMemo(() => {
    return menuData.map((section) => {
      let items = section.items || [];

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        items = items.filter((item) => {
          const hay = [
            item.name_en,
            item.name_ar,
            item.price,
            item.calories,
            section.name_en,
            item.sold_out ? "sold out" : "",
            item.vegetarian ? "vegetarian" : "",
            item.vegan ? "vegan" : "",
            item.new_item ? "new seasonal" : ""]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
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
        assertMenuMutation(await createCategory(payload), "createCategory");
        await noteDraftChanged();
        showToast(guestMenuSuccessMessage("Category created. Saved. Publish when ready."));
      } else {
        assertMenuMutation(await updateCategory(catEditData.id, catEditData), "updateCategory");
        await noteDraftChanged();
        showToast(guestMenuSuccessMessage("Category updated. Saved. Publish when ready."));
      }
      setCatEditMode(null);
      const cats = await loadCategories();
      if (!selectedCatId && cats.length > 0) {
        setSelectedCatId(cats[0].id);
      }
    } catch (e) {
      showToast(friendlyActionErrorMessage(e, "Could not save category. Please try again."), "error");
    }
  }, [catEditMode, catEditData, loadCategories, showToast, selectedCatId, readOnlyMenu, rbac.profile, menuBranch, noteDraftChanged]);

  const handleDeleteCategory = useCallback((cat, e) => {
    e.stopPropagation();
    setConfirm({
      title: "Delete Category",
      message: `Delete "${cat.name_en}"? All sections and items within will also be removed.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          assertMenuMutation(await deleteCategory(cat.id), "deleteCategory");
          await noteDraftChanged();
          showToast(guestMenuSuccessMessage("Category removed. Publish when ready."));
          const cats = await loadCategories();
          if (selectedCatId === cat.id) {
            setSelectedCatId(cats.length > 0 ? cats[0].id : null);
          }
        } catch (e) {
          showToast(friendlyActionErrorMessage(e, "Could not delete category. Please try again."), "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [loadCategories, showToast, selectedCatId, noteDraftChanged]);

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
      await noteDraftChanged();
    } catch (e) {
      showToast("Failed to reorder", "error");
      loadCategories();
    }
  }, [categories, loadCategories, showToast, noteDraftChanged]);

  // ── Section CRUD ──

  const handleAddSection = useCallback(() => {
    if (!selectedCatId || readOnlyMenu) return;
    setSectionCreateOpen(true);
    setSectionCreateData({ name_en: "", name_ar: "" });
  }, [selectedCatId, readOnlyMenu]);

  const handleCreateSection = useCallback(async () => {
    if (!selectedCatId || readOnlyMenu) return;
    if (!sectionCreateData.name_en.trim()) {
      showToast("Section name (English) is required", "error");
      return;
    }
    setSectionCreateSaving(true);
    try {
      assertMenuBranchAccess(rbac.profile, menuBranch);
      assertMenuMutation(await createSection({
        name_en: sectionCreateData.name_en.trim(),
        name_ar: sectionCreateData.name_ar.trim(),
        category_id: selectedCatId,
        sort_order: menuData.length,
        branch_id: menuBranch,
      }), "createSection");
      await noteDraftChanged();
      showToast(guestMenuSuccessMessage("Section created. Saved. Publish when ready."));
      setSectionCreateOpen(false);
      setSectionCreateData({ name_en: "", name_ar: "" });
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(friendlyActionErrorMessage(e, "Could not create section. Please try again."), "error");
    } finally {
      setSectionCreateSaving(false);
    }
  }, [
    selectedCatId,
    readOnlyMenu,
    sectionCreateData,
    menuData.length,
    showToast,
    loadMenuForCategory,
    rbac.profile,
    menuBranch,
      noteDraftChanged]);

  const handleSaveSection = useCallback(async (sectionId) => {
    try {
      assertMenuMutation(await updateSection(sectionId, sectionEditData), "updateSection");
      await noteDraftChanged();
      showToast(guestMenuSuccessMessage("Section updated. Saved. Publish when ready."));
      setSectionEditId(null);
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(friendlyActionErrorMessage(e, "Could not update section. Please try again."), "error");
    }
  }, [sectionEditData, showToast, loadMenuForCategory, selectedCatId, noteDraftChanged]);

  const handleDeleteSection = useCallback((section) => {
    setConfirm({
      title: "Delete Section",
      message: `Delete "${section.name_en}"? All items in this section will be removed.`,
      onConfirm: async () => {
        setConfirmLoading(true);
        try {
          assertMenuMutation(await deleteSection(section.id), "deleteSection");
          await noteDraftChanged();
          showToast(guestMenuSuccessMessage("Section removed. Publish when ready."));
          loadMenuForCategory(selectedCatId);
        } catch (e) {
          showToast(friendlyActionErrorMessage(e, "Could not delete section. Please try again."), "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [showToast, loadMenuForCategory, selectedCatId, noteDraftChanged]);

  const handleReorderSection = useCallback(async (sectionId, direction) => {
    const index = menuData.findIndex((section) => section.id === sectionId);
    if (index < 0) return;
    const swapIdx = index + direction;
    if (swapIdx < 0 || swapIdx >= menuData.length) return;
    const snapshot = cloneSections(menuData);
    const newSections = cloneSections(menuData);
    [newSections[index], newSections[swapIdx]] = [newSections[swapIdx], newSections[index]];
    setMenuData(newSections);
    setOrderStatus("saving");
    try {
      const ordered = buildSectionOrderUpdates(newSections);
      assertMenuMutation(await reorderSections(ordered), "reorderSections");
      await noteDraftChanged();
      setOrderStatus("saved");
      window.setTimeout(() => setOrderStatus(null), 1400);
    } catch (e) {
      setMenuData(snapshot);
      setOrderStatus(null);
      showToast("Failed to reorder sections", "error");
    }
  }, [menuData, showToast, noteDraftChanged]);

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

      await noteDraftChanged();

      const allInactive = added.every((item) => item.active === false);
      showToast(allInactive
        ? `${added.length > 1 ? `${added.length} inactive items` : added[0].name_en} added to ${addItemTarget.sectionName}. They remain hidden until activated.`
        : added.length > 1
          ? guestMenuSuccessMessage(`${added.length} items added to ${addItemTarget.sectionName}. Saved. Publish when ready.`)
          : guestMenuSuccessMessage(`${added[0].name_en} added to ${addItemTarget.sectionName}. Saved. Publish when ready.`));
      setAddItemModalOpen(false);
      setAddItemTarget(null);
      setBranchCatalogue([]);
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      setPublishStage(MENU_PUBLISH_STAGES.FAILED);
      showToast(friendlyActionErrorMessage(e, "Could not add items. Please try again."), "error");
      await loadMenuForCategory(selectedCatId);
    } finally {
      setAddItemSaving(false);
    }
  }, [
    addItemTarget,
    loadMenuForCategory,
    menuBranch,

    rbac.profile,
    selectedCatId,
    showToast,  noteDraftChanged]);

  const openEditItem = useCallback(async (item) => {
    let record = item;
    if (item?.id && supabase && (item.desc_en === undefined || item.desc_ar === undefined)) {
      try {
        const { data: full } = await supabase
          .from("menu_items")
          .select("*")
          .eq("id", item.id)
          .eq("branch_id", menuBranch)
          .maybeSingle();
        if (full) record = { ...item, ...full };
      } catch {
        record = item;
      }
    }
    const secRow = sectionsCatalog.find((s) => s.id === record.section_id);
    const categoryId = secRow?.category_id || record.category_id || selectedCatId || "";

    setEditorMode("edit");
    setEditingItem({
      name_en: record.name_en || "",
      name_ar: record.name_ar || "",
      desc_en: record.desc_en || "",
      desc_ar: record.desc_ar || "",
      price: record.price ?? "",
      calories: record.calories ?? "",
      image: record.image || "",
      category_id: categoryId,
      section_id: record.section_id || "",
      sold_out: record.sold_out || false,
      featured: record.featured || false,
      new_item: record.new_item || false,
      vegetarian: record.vegetarian || false,
      vegan: record.vegan || false,
      active: record.active !== false,
      hidden_until: record.hidden_until || null,
    });
    setEditingItemId(record.id);

    let linkedAddonIds = [];
    let linkedAllergenIds = [];
    try {
      [linkedAddonIds, linkedAllergenIds] = await Promise.all([
        fetchItemAddonIds(record.id),
        fetchItemAllergenIds(record.id)]);
    } catch {
      linkedAddonIds = (record.add_ons || []).map((a) => a.id || a);
      linkedAllergenIds = (record.allergens || []).map((a) => a.id || a);
    }
    setItemAllergenIds(linkedAllergenIds);
    setItemAddOnIds(linkedAddonIds);
    setImageFile(null);
    setImagePreview(record.image || "");
    setRemovedPlacementIds([]);

    const groupId = record.placement_group_id || null;
    setPlacementGroupId(groupId);

    if (groupId) {
      const { data: members } = await fetchPlacementGroupMembers(groupId);
      const extras = hydratePlacementCategoryIds(
        buildExtraPlacementsFromMembers(
          members,
          record.id,
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
  }, [selectedCatId, sectionsCatalog, menuBranch]);

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

      const publishedAt = Date.now();
      await noteDraftChanged();
      setToast({
        message: `✓ Menu item saved. Publish when ready. ${formatRelativeTimestamp(publishedAt, publishedAt)}`,
        type: "success",
      });

      setEditorOpen(false);
      setEditorBaseline(null);
      resetPlacementEditor();
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      setPublishStage(MENU_PUBLISH_STAGES.FAILED);
      showToast(friendlyActionErrorMessage(e, "Could not save item. Please try again."), "error");
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
    sectionsCatalog,
    noteDraftChanged,
  ]);

  const handleToggleSoldOut = useCallback(async (item) => {
    const newVal = !item.sold_out;
    try {
      assertMenuMutation(await toggleSoldOut(item.id, newVal), "toggleSoldOut");
      const { data: verified } = await fetchMenuItemById(item.id);
      if (verified && Boolean(verified.sold_out) !== newVal) {
        throw new Error("Sold out did not persist");
      }
      await noteDraftChanged();
      showToast(
        newVal
          ? guestMenuSuccessMessage("Marked sold out. Publish when ready.")
          : guestMenuSuccessMessage("Marked available. Publish when ready."),
      );
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(friendlyActionErrorMessage(e, "Could not update sold out status. Please try again."), "error");
      await loadMenuForCategory(selectedCatId);
    }
  }, [showToast, loadMenuForCategory, selectedCatId, noteDraftChanged]);

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
      await noteDraftChanged();
      setVisibilityTarget(null);
      showToast(guestMenuSuccessMessage("Visibility saved. Publish when ready."));
      await loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(friendlyActionErrorMessage(e, "Could not update visibility. Please try again."), "error");
      await loadMenuForCategory(selectedCatId);
    } finally {
      setVisibilityLoading(false);
    }
  }, [visibilityTarget, visibilityForm, showToast, loadMenuForCategory, selectedCatId, noteDraftChanged]);

  const handleDuplicateItem = useCallback(async (item, e) => {
    e.stopPropagation();
    try {
      assertMenuMutation(await duplicateMenuItem(item.id), "duplicateMenuItem");
      await noteDraftChanged();
      showToast(guestMenuSuccessMessage("Item duplicated. Publish when ready."));
      loadMenuForCategory(selectedCatId);
    } catch (e) {
      showToast(e?.message || "Failed to duplicate", "error");
    }
  }, [showToast, loadMenuForCategory, selectedCatId, noteDraftChanged]);

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
          await noteDraftChanged();
          showToast(guestMenuSuccessMessage("Item removed. Publish when ready."));
          loadMenuForCategory(selectedCatId);
        } catch (e) {
          showToast(e?.message || "Failed to delete item", "error");
        } finally {
          setConfirmLoading(false);
          setConfirm(null);
        }
      },
    });
  }, [showToast, loadMenuForCategory, selectedCatId, noteDraftChanged]);

  const handleReorderItem = useCallback(async (sectionId, itemId, direction) => {
    const loc = findItemLocation(menuData, itemId);
    if (!loc || loc.sectionId !== sectionId) return;
    const swapIdx = loc.itemIndex + direction;
    const items = menuData[loc.sectionIndex].items || [];
    if (swapIdx < 0 || swapIdx >= items.length) return;
    const snapshot = cloneSections(menuData);
    const result = moveItemBetweenSections(menuData, itemId, sectionId, swapIdx);
    if (result.error) return;
    setMenuData(result.sections);
    setOrderStatus("saving");
    try {
      const ordered = buildItemOrderUpdates(result.sections, [sectionId]);
      assertMenuMutation(await reorderItems(ordered), "reorderItems");
      await noteDraftChanged();
      setOrderStatus("saved");
      window.setTimeout(() => setOrderStatus(null), 1400);
    } catch (e) {
      setMenuData(snapshot);
      setOrderStatus(null);
      showToast("Failed to reorder", "error");
    }
  }, [menuData, showToast, noteDraftChanged]);

  const dndEnabled = useMemo(
    () =>
      !readOnlyMenu &&
      !publishInFlight &&
      !searchQuery.trim() &&
      activeFilter === "all",
    [readOnlyMenu, publishInFlight, searchQuery, activeFilter],
  );

  const clearCollapseExpandTimer = useCallback(() => {
    if (collapseExpandTimerRef.current) {
      window.clearTimeout(collapseExpandTimerRef.current);
      collapseExpandTimerRef.current = null;
    }
  }, []);

  const persistBoardTransition = useCallback(
    async (beforeSections, afterSections, {
      label,
      action = "reorder_items",
      entityId = null,
      pushUndo = true,
      silent = false,
    } = {}) => {
      const diff = diffBoardPlacements(beforeSections, afterSections);
      if (!silent) setOrderStatus("saving");
      try {
        for (const move of diff.moves) {
          assertMenuMutation(
            await moveMenuItemToSection(move.itemId, move.sectionId),
            "moveMenuItemToSection",
          );
        }
        if (diff.orderUpdates.length) {
          assertMenuMutation(await reorderItems(diff.orderUpdates), "reorderItems");
        }
        await noteDraftChanged();
        if (!silent) {
          setOrderStatus("saved");
          window.setTimeout(() => setOrderStatus(null), 1400);
        }
        if (pushUndo) {
          undoApi.push({
            label,
            undo: async () => {
              setMenuData(beforeSections);
              await persistBoardTransition(afterSections, beforeSections, {
                label: `Undo ${label}`,
                action,
                pushUndo: false,
                silent: true,
              });
            },
            redo: async () => {
              setMenuData(afterSections);
              await persistBoardTransition(beforeSections, afterSections, {
                label,
                action,
                pushUndo: false,
                silent: true,
              });
            },
          });
        }
        return true;
      } catch (error) {
        setMenuData(beforeSections);
        if (!silent) {
          setOrderStatus(null);
          showToast(
            friendlyActionErrorMessage(error, "Could not save new order. Please try again."),
            "error",
          );
        }
        throw error;
      } finally {
        dragSnapshotRef.current = null;
      }
    },
    [showToast, undoApi, noteDraftChanged],
  );

  const persistItemBoardChange = useCallback(
    async (beforeSections, nextSections, meta) => {
      const count = meta.movedIds?.length || 1;
      const label = meta.crossSection
        ? (count > 1 ? `Moved ${count} items` : "Moved item")
        : (count > 1 ? `Reordered ${count} items` : "Reordered item");
      try {
        await persistBoardTransition(beforeSections, nextSections, {
          label,
          action: meta.crossSection ? "move_item_section" : "reorder_items",
          entityId: meta.itemId,
        });
      } catch (_) {
        /* toast handled */
      }
    },
    [persistBoardTransition],
  );

  const getDragGroupIds = useCallback((activeItemId) => {
    const selected = selectionApi.selectedIds || [];
    if (selected.includes(activeItemId) && selected.length > 1) return selected;
    return [activeItemId];
  }, [selectionApi.selectedIds]);

  const handleBoardDragStart = useCallback((event) => {
    dragSnapshotRef.current = cloneSections(menuData);
    const itemId = parseItemDndId(event.active.id);
    if (itemId && !selectionApi.selectedIds.includes(itemId)) {
      selectionApi.selectOnly(itemId);
    }
    const groupIds = itemId ? getDragGroupIds(itemId) : [];
    const label =
      event.active?.data?.current?.label ||
      (itemId ? "Menu item" : "Section");
    setActiveDragLabel(label);
    setActiveDragCount(Math.max(groupIds.length, 1));
  }, [menuData, selectionApi, getDragGroupIds]);

  const handleBoardDragOver = useCallback((event) => {
    const { active, over } = event;
    if (!over) return;

    const activeSectionId = parseSectionDndId(active.id);
    const overSectionId = parseSectionDndId(over.id);
    if (activeSectionId && overSectionId && activeSectionId !== overSectionId) {
      setMenuData((prev) => reorderSectionsById(prev, activeSectionId, overSectionId));
      return;
    }

    const activeItemId = parseItemDndId(active.id);
    if (!activeItemId) return;
    const groupIds = getDragGroupIds(activeItemId);

    setMenuData((prev) => {
      const target = resolveItemDropTarget(prev, activeItemId, over.id);
      if (!target) return prev;

      for (const id of groupIds) {
        const gate = canMoveItemToSection(prev, id, target.destinationSectionId);
        if (!gate.ok) return prev;
      }

      const activeLoc = findItemLocation(prev, activeItemId);
      if (!activeLoc) return prev;
      if (activeLoc.sectionId === target.destinationSectionId && groupIds.length === 1) {
        return prev;
      }

      if (!expandedSections[target.destinationSectionId]) {
        clearCollapseExpandTimer();
        collapseExpandTimerRef.current = window.setTimeout(() => {
          setExpandedSections((current) => ({
            ...current,
            [target.destinationSectionId]: true,
          }));
        }, 550);
      }

      if (groupIds.length > 1 || activeLoc.sectionId !== target.destinationSectionId) {
        const moved = moveSelectedGroup(
          prev,
          groupIds,
          target.destinationSectionId,
          target.destinationIndex,
        );
        return moved.error ? prev : moved.sections;
      }
      return prev;
    });
  }, [expandedSections, clearCollapseExpandTimer, getDragGroupIds]);

  const handleBoardDragEnd = useCallback(async (event) => {
    clearCollapseExpandTimer();
    setActiveDragLabel(null);
    setActiveDragCount(1);
    const { active, over } = event;
    const snapshot = dragSnapshotRef.current;

    if (!over) {
      if (snapshot) setMenuData(snapshot);
      dragSnapshotRef.current = null;
      return;
    }

    const activeSectionId = parseSectionDndId(active.id);
    if (activeSectionId) {
      const ordered = buildSectionOrderUpdates(menuData);
      const unchanged =
        snapshot &&
        snapshot.length === menuData.length &&
        snapshot.every((section, index) => section.id === menuData[index]?.id);
      if (unchanged) {
        dragSnapshotRef.current = null;
        return;
      }
      const before = snapshot || menuData;
      const after = menuData;
      setOrderStatus("saving");
      try {
        assertMenuMutation(await reorderSections(ordered), "reorderSections");
        await noteDraftChanged();
        setOrderStatus("saved");
        window.setTimeout(() => setOrderStatus(null), 1400);
        undoApi.push({
          label: "Reordered sections",
          undo: async () => {
            setMenuData(before);
            assertMenuMutation(await reorderSections(buildSectionOrderUpdates(before)), "reorderSections");
            await noteDraftChanged();
          },
          redo: async () => {
            setMenuData(after);
            assertMenuMutation(await reorderSections(ordered), "reorderSections");
            await noteDraftChanged();
          },
        });
      } catch (error) {
        if (snapshot) setMenuData(snapshot);
        setOrderStatus(null);
        showToast("Failed to reorder sections", "error");
      } finally {
        dragSnapshotRef.current = null;
      }
      return;
    }

    const activeItemId = parseItemDndId(active.id);
    if (!activeItemId) {
      dragSnapshotRef.current = null;
      return;
    }

    const prior = snapshot || menuData;
    const groupIds = getDragGroupIds(activeItemId);
    const priorLoc = findItemLocation(prior, activeItemId);
    if (!priorLoc) {
      dragSnapshotRef.current = null;
      return;
    }

    const target = resolveItemDropTarget(menuData, activeItemId, over.id)
      || resolveItemDropTarget(prior, activeItemId, over.id);
    if (!target) {
      if (snapshot) setMenuData(snapshot);
      dragSnapshotRef.current = null;
      return;
    }

    for (const id of groupIds) {
      const gate = canMoveItemToSection(prior, id, target.destinationSectionId);
      if (!gate.ok) {
        if (snapshot) setMenuData(snapshot);
        dragSnapshotRef.current = null;
        showToast(gate.reason || "That drop is not allowed for the selection.", "error");
        return;
      }
    }

    const moved = moveSelectedGroup(
      prior,
      groupIds,
      target.destinationSectionId,
      target.destinationIndex,
    );
    if (moved.error) {
      if (snapshot) setMenuData(snapshot);
      dragSnapshotRef.current = null;
      showToast(moved.error, "error");
      return;
    }

    const nextLoc = findItemLocation(moved.sections, activeItemId);
    const unchanged =
      groupIds.length === 1 &&
      nextLoc &&
      nextLoc.sectionId === priorLoc.sectionId &&
      nextLoc.itemIndex === priorLoc.itemIndex;
    if (unchanged) {
      dragSnapshotRef.current = null;
      return;
    }

    setMenuData(moved.sections);
    await persistItemBoardChange(prior, moved.sections, {
      itemId: activeItemId,
      movedIds: groupIds,
      sourceSectionId: priorLoc.sectionId,
      destinationSectionId: target.destinationSectionId,
      crossSection: priorLoc.sectionId !== target.destinationSectionId,
    });
  }, [
    clearCollapseExpandTimer,
    menuData,
    persistItemBoardChange,

    showToast,
    undoApi,
    getDragGroupIds,  noteDraftChanged]);

  const handleBoardDragCancel = useCallback(() => {
    clearCollapseExpandTimer();
    setActiveDragLabel(null);
    setActiveDragCount(1);
    if (dragSnapshotRef.current) setMenuData(dragSnapshotRef.current);
    dragSnapshotRef.current = null;
  }, [clearCollapseExpandTimer]);

  const applyBulkVisibility = useCallback(async (ids, patch, label) => {
    if (!ids.length || readOnlyMenu) return;
    if (shouldConfirmBulk(patch.active === false || patch.hidden_until ? "hide" : "show", ids.length)) {
      const ok = window.confirm(`${label} for ${ids.length} items?`);
      if (!ok) return;
    }
    const before = cloneSections(menuData);
    try {
      setOrderStatus("saving");
      for (const id of ids) {
        assertMenuMutation(await applyMenuItemVisibility(id, patch), "applyMenuItemVisibility");
      }
      await noteDraftChanged();
      await loadMenuForCategory(selectedCatId);
      setOrderStatus("saved");
      window.setTimeout(() => setOrderStatus(null), 1400);
      undoApi.push({
        label,
        undo: async () => {
          // Best-effort restore from prior board snapshot fields.
          for (const section of before) {
            for (const item of section.items || []) {
              if (!ids.includes(item.id)) continue;
              assertMenuMutation(
                await applyMenuItemVisibility(item.id, {
                  active: item.active !== false,
                  hidden_until: item.hidden_until ?? null,
                  sold_out: Boolean(item.sold_out),
                }),
                "applyMenuItemVisibility",
              );
            }
          }
          await noteDraftChanged();
          await loadMenuForCategory(selectedCatId);
        },
        redo: async () => {
          for (const id of ids) {
            assertMenuMutation(await applyMenuItemVisibility(id, patch), "applyMenuItemVisibility");
          }
          await noteDraftChanged();
          await loadMenuForCategory(selectedCatId);
        },
      });
    } catch (error) {
      setOrderStatus(null);
      showToast(friendlyActionErrorMessage(error, "Bulk update failed"), "error");
      await loadMenuForCategory(selectedCatId);
    }
  }, [menuData, readOnlyMenu, loadMenuForCategory, selectedCatId, showToast, undoApi, noteDraftChanged]);

  const applyBulkSoldOut = useCallback(async (ids, soldOut) => {
    if (!ids.length || readOnlyMenu) return;
    const label = soldOut ? `Marked ${ids.length} sold out` : `Marked ${ids.length} available`;
    try {
      setOrderStatus("saving");
      for (const id of ids) {
        assertMenuMutation(await toggleSoldOut(id, soldOut), "toggleSoldOut");
      }
      await noteDraftChanged();
      await loadMenuForCategory(selectedCatId);
      setOrderStatus("saved");
      window.setTimeout(() => setOrderStatus(null), 1400);
      undoApi.push({
        label,
        undo: async () => {
          for (const id of ids) {
            assertMenuMutation(await toggleSoldOut(id, !soldOut), "toggleSoldOut");
          }
          await noteDraftChanged();
          await loadMenuForCategory(selectedCatId);
        },
        redo: async () => {
          for (const id of ids) {
            assertMenuMutation(await toggleSoldOut(id, soldOut), "toggleSoldOut");
          }
          await noteDraftChanged();
          await loadMenuForCategory(selectedCatId);
        },
      });
    } catch (error) {
      setOrderStatus(null);
      showToast(friendlyActionErrorMessage(error, "Bulk sold out update failed"), "error");
      await loadMenuForCategory(selectedCatId);
    }
  }, [readOnlyMenu, loadMenuForCategory, selectedCatId, showToast, undoApi, noteDraftChanged]);

  const moveSelectionToSection = useCallback(async (sectionId) => {
    const ids = selectionApi.selectedIds;
    if (!ids.length) return;
    const before = cloneSections(menuData);
    const dest = menuData.find((s) => s.id === sectionId);
    const insertAt = (dest?.items || []).length;
    const moved = moveSelectedGroup(before, ids, sectionId, insertAt);
    if (moved.error) {
      showToast(moved.error, "error");
      return;
    }
    setMenuData(moved.sections);
    setMoveSheetOpen(false);
    await persistItemBoardChange(before, moved.sections, {
      itemId: ids[0],
      movedIds: ids,
      sourceSectionId: findItemLocation(before, ids[0])?.sectionId,
      destinationSectionId: sectionId,
      crossSection: true,
    });
  }, [selectionApi.selectedIds, menuData, persistItemBoardChange, showToast]);

  const openQuickLook = useCallback((itemId) => {
    const id = itemId || selectionApi.focusId || selectionApi.selectedIds[0];
    if (!id) return;
    setQuickLookItemId(id);
  }, [selectionApi.focusId, selectionApi.selectedIds]);

  const goToItem = useCallback((item) => {
    if (!item) return;
    const sectionId = item.section_id;
    if (sectionId) {
      setExpandedSections((prev) => ({ ...prev, [sectionId]: true }));
    }
    selectionApi.selectOnly(item.id);
    window.setTimeout(() => {
      const node = document.querySelector(`[data-testid="sortable-item-${item.id}"]`);
      if (node) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        node.classList.add("mm-item-card--pulse");
        window.setTimeout(() => node.classList.remove("mm-item-card--pulse"), 1200);
      }
    }, 50);
  }, [selectionApi]);

  const paletteCommands = useMemo(() => {
    const commands = [
      { id: "palette-help", label: "Keyboard shortcuts", group: "Commands", keywords: "help", run: () => setShortcutsOpen(true) },
      {
        id: "select-all-visible",
        label: "Select All Visible",
        group: "Commands",
        keywords: "multi select",
        run: () => selectionApi.selectAll(filteredSections),
      },
      {
        id: "clear-selection",
        label: "Clear Selection",
        group: "Commands",
        keywords: "deselect",
        run: () => selectionApi.clear(),
      },
      { id: "toggle-nav-sidebar", label: "Toggle Navigation Sidebar", group: "View", keywords: "collapse expand global nav", run: () => emitSidebarToggle("global") },
      { id: "toggle-menu-sidebar", label: "Toggle Menu Sidebar", group: "View", keywords: "collapse expand categories", run: () => emitSidebarToggle("menu") },
      {
        id: "expand-both-sidebars",
        label: "Expand Both Sidebars",
        group: "View",
        keywords: "show panels",
        run: () => {
          writeSidebarCollapsed(SIDEBAR_KEYS.global, false);
          writeSidebarCollapsed(SIDEBAR_KEYS.menu, false);
        },
      },
      {
        id: "collapse-both-sidebars",
        label: "Collapse Both Sidebars",
        group: "View",
        keywords: "hide panels workspace",
        run: () => {
          writeSidebarCollapsed(SIDEBAR_KEYS.global, true);
          writeSidebarCollapsed(SIDEBAR_KEYS.menu, true);
        },
      },
      { id: "quicklook", label: "Open Quick Look", group: "Commands", keywords: "space preview", run: () => openQuickLook() },
      { id: "preview-live", label: "Preview Live Menu", group: "Publish", keywords: "guest published", run: () => { setPreviewMode("live"); setPreviewOpen(true); } },
      { id: "preview-draft", label: "Preview Draft Menu", group: "Publish", keywords: "current unpublished", run: () => { setPreviewMode("draft"); setPreviewOpen(true); } },
      { id: "publish-changes", label: "Publish Changes", group: "Publish", keywords: "guest version", run: () => handleManualPublish() },
      { id: "view-unpublished", label: "View Unpublished Changes", group: "Publish", keywords: "diff", run: () => { setPublishDiffOpen(true); publishIntel.refresh(); } },
      { id: "view-versions", label: "View Menu Versions", group: "Publish", keywords: "history", run: () => setVersionHistoryOpen(true) },
      { id: "compare-live", label: "Compare with Live", group: "Publish", keywords: "diff version", run: () => { setPublishDiffOpen(true); publishIntel.refresh(); } },
      { id: "hide-selected", label: "Hide selected", group: "Commands", keywords: "visibility", run: () => applyBulkVisibility(selectionApi.selectedIds, { active: false, hidden_until: null }, `Hidden ${selectionApi.count} items`) },
      { id: "show-selected", label: "Show selected", group: "Commands", keywords: "visibility", run: () => applyBulkVisibility(selectionApi.selectedIds, { active: true, hidden_until: null }, `Showed ${selectionApi.count} items`) },
      { id: "soldout-selected", label: "Mark selected sold out", group: "Commands", run: () => applyBulkSoldOut(selectionApi.selectedIds, true) },
      { id: "move-selected", label: "Move Selected To…", group: "Commands", run: () => setMoveSheetOpen(true) }];
    categories.forEach((cat) => {
      commands.push({
        id: `go-cat-${cat.id}`,
        label: `Go to ${cat.name_en}`,
        group: "Navigation",
        keywords: cat.name_en,
        run: () => setSelectedCatId(cat.id),
      });
    });
    flattenVisibleItems(menuData).forEach((row) => {
      commands.push({
        id: `item-${row.itemId}`,
        label: row.item.name_en || "Item",
        group: "Items",
        keywords: `${row.item.name_en || ""} ${row.item.name_ar || ""} ${row.item.price || ""}`,
        run: () => goToItem(row.item),
      });
    });
    return commands;
  }, [
    categories,
    menuData,
    filteredSections,
    openQuickLook,
    applyBulkVisibility,
    applyBulkSoldOut,
    selectionApi,
    goToItem,
    handleManualPublish,
    publishIntel]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isEditableTarget(event.target) || editorOpen || paletteOpen) {
        if (paletteOpen && event.key === "Escape") {
          event.preventDefault();
          setPaletteOpen(false);
        }
        return;
      }
      if (event.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        else if (quickLookItemId) setQuickLookItemId(null);
        else if (moveSheetOpen) setMoveSheetOpen(false);
        else if (shortcutsOpen) setShortcutsOpen(false);
        else selectionApi.clear();
        return;
      }
      if (event.key === " " && !event.repeat) {
        event.preventDefault();
        openQuickLook();
        return;
      }
      if (isModKey(event) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectionApi.selectAll(filteredSections);
        return;
      }
      if (isModKey(event) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (isModKey(event) && event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleMenuSidebar();
        return;
      }
      if (isModKey(event) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) undoApi.redo();
        else undoApi.undo();
        return;
      }
      if (!isApplePlatform() && event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        undoApi.redo();
        return;
      }
      if (event.key === "Enter" && selectionApi.focusId) {
        const loc = findItemLocation(menuData, selectionApi.focusId);
        if (loc?.item) openEditItem(loc.item);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editorOpen,
    paletteOpen,
    contextMenu,
    quickLookItemId,
    moveSheetOpen,
    shortcutsOpen,
    selectionApi,
    filteredSections,
    openQuickLook,
    undoApi,
    menuData,
    openEditItem,
    toggleMenuSidebar]);

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

  const selectedItems = useMemo(() => {
    const idSet = new Set(selectionApi.selectedIds || []);
    if (!idSet.size) return [];
    const items = [];
    (menuData || []).forEach((section) => {
      (section.items || []).forEach((item) => {
        if (idSet.has(item.id)) items.push(item);
      });
    });
    return items;
  }, [menuData, selectionApi.selectedIds]);

  const selectionAggregates = useMemo(
    () => summarizeSelectionAggregates(selectedItems, nowMs),
    [selectedItems, nowMs],
  );

  const commandDockVisible =
    selectionApi.count >= 2 || (coarsePointer && selectionApi.count >= 1);

  const fluidDnd =
    selectionApi.count >= 2 || (coarsePointer && selectionApi.count >= 1);

  const hideSelected = useCallback(() => {
    applyBulkVisibility(
      selectionApi.selectedIds,
      { active: false, hidden_until: null },
      `Hidden ${selectionApi.count} items`,
    );
  }, [applyBulkVisibility, selectionApi.selectedIds, selectionApi.count]);

  const showSelected = useCallback(() => {
    applyBulkVisibility(
      selectionApi.selectedIds,
      { active: true, hidden_until: null },
      `Showed ${selectionApi.count} items`,
    );
  }, [applyBulkVisibility, selectionApi.selectedIds, selectionApi.count]);

  const markSelectedSoldOut = useCallback(() => {
    applyBulkSoldOut(selectionApi.selectedIds, true);
  }, [applyBulkSoldOut, selectionApi.selectedIds]);

  const markSelectedAvailable = useCallback(() => {
    applyBulkSoldOut(selectionApi.selectedIds, false);
  }, [applyBulkSoldOut, selectionApi.selectedIds]);

  const runPrimaryVisibilityAction = useCallback(() => {
    if (selectionAggregates.visibilityMode === "hidden") showSelected();
    else hideSelected();
  }, [selectionAggregates.visibilityMode, hideSelected, showSelected]);

  const runPrimarySoldOutAction = useCallback(() => {
    if (selectionAggregates.soldOutMode === "sold_out") markSelectedAvailable();
    else markSelectedSoldOut();
  }, [selectionAggregates.soldOutMode, markSelectedAvailable, markSelectedSoldOut]);

  const selectSimilarSection = useCallback((itemId) => {
    const loc = findItemLocation(menuData, itemId);
    if (!loc) return;
    const ids = (menuData[loc.sectionIndex].items || []).map((i) => i.id);
    selectionApi.setSelection({
      selectedIds: ids,
      anchorId: ids[0] || null,
      focusId: itemId || null,
    });
  }, [menuData, selectionApi]);

  const commandDockMoreItems = useMemo(
    () => [
      {
        id: "quicklook",
        label: "Quick Look",
        onSelect: () => openQuickLook(selectionApi.focusId || selectionApi.selectedIds[0]),
      },
      {
        id: "select-section",
        label: "Select Similar → Same section",
        onSelect: () =>
          selectSimilarSection(selectionApi.focusId || selectionApi.selectedIds[0]),
      },
      { id: "sep-more", type: "separator" },
      {
        id: "shortcuts",
        label: "Keyboard Shortcuts",
        onSelect: () => setShortcutsOpen(true),
      }],
    [openQuickLook, selectSimilarSection, selectionApi.focusId, selectionApi.selectedIds],
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
  const lastPublishedLabel = useMemo(
    () => formatLastPublishedLabel(publishStatus?.last_published_at),
    [publishStatus?.last_published_at],
  );

  const locatePreviewItem = useCallback((itemId) => {
    if (!itemId) return;
    const loc = findItemLocation(menuData, itemId);
    goToItem({ id: itemId, section_id: loc?.sectionId });
  }, [goToItem, menuData]);

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
    <div className={`mm ${commandDockVisible ? "has-command-dock" : ""} ${previewOpen ? "has-publish-preview" : ""}`}>
      <div className="mm-top-shell">
        <MenuPublishStatusBar
          state={publishBarState}
          friendlyError={friendlyPublishError}
          publishing={publishInFlight}
          onPublish={handleManualPublish}
          onRetry={handleRetryPublish}
          onPreview={() => {
            setPreviewMode(publishIntel.diff?.hasChanges ? "draft" : "live");
            setPreviewOpen(true);
          }}
          onViewChanges={() => {
            publishIntel.refresh();
            setPublishDiffOpen(true);
          }}
          onViewVersions={() => setVersionHistoryOpen(true)}
          liveMenuUrl={liveMenuUrl}
          readOnly={readOnlyMenu}
          lastPublishedLabel={lastPublishedLabel}
          liveVersion={
            publishIntel.livePublication?.version
            ?? publishStatus?.published_version
            ?? publishStatus?.guest_version
            ?? null
          }
          pendingChangeCount={publishDiff?.counts?.total || 0}
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
      <div className={`mm-body ${menuSidebarCollapsed ? "mm-body--menu-sidebar-collapsed" : ""}`}>

      {/* ═══ SIDEBAR ═══ */}
      <aside
        className={`mm-sidebar ${menuSidebarCollapsed ? "is-collapsed" : ""}`}
        data-testid="menu-category-sidebar"
        aria-label="Menu categories"
        data-collapsed={menuSidebarCollapsed ? "true" : "false"}
      >
        <button
          type="button"
          className="mm-sidebar-edge-toggle"
          onClick={toggleMenuSidebar}
          aria-label={menuSidebarCollapsed ? "Expand menu categories" : "Collapse menu categories"}
          aria-controls="mm-category-list"
          aria-expanded={!menuSidebarCollapsed}
          data-testid="menu-sidebar-toggle"
          title={menuSidebarCollapsed ? "Expand menu categories" : "Collapse menu categories"}
        >
          {menuSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        <div className="mm-sidebar-rail" data-testid="menu-sidebar-rail">
          <button
            type="button"
            className="mm-sidebar-rail-context"
            onClick={expandMenuSidebar}
            title={selectedCategory?.name_en || "Menu categories"}
            aria-label={
              selectedCategory
                ? `Expand categories — current: ${selectedCategory.name_en}`
                : "Expand menu categories"
            }
          >
            <UtensilsCrossed size={16} aria-hidden="true" />
            <span className="mm-sidebar-rail-pill" aria-hidden="true">
              {(selectedCategory?.name_en || "Menu").slice(0, 2)}
            </span>
          </button>
        </div>

        <div className="mm-sidebar-expanded-content">
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

          <div className="mm-cat-list" id="mm-category-list">
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
                  {publishIntel.diff?.changesByCategoryId?.[cat.id] ? (
                    <span className="mm-cat-change-count">
                      {publishIntel.diff.changesByCategoryId[cat.id]}
                    </span>
                  ) : null}
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
        </div>
      </aside>

      {menuSidebarCollapsed ? (
        <button
          type="button"
          className="mm-sidebar-mobile-reveal"
          onClick={expandMenuSidebar}
          data-testid="menu-sidebar-mobile-reveal"
          aria-label={
            selectedCategory
              ? `Show categories — ${selectedCategory.name_en}`
              : "Show menu categories"
          }
        >
          <ChevronRight size={14} />
          <span>{selectedCategory?.name_en || "Categories"}</span>
        </button>
      ) : null}

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
                {orderStatus === "saving" && (
                  <span className="mm-order-status" data-testid="order-status-saving"> · Saving…</span>
                )}
                {orderStatus === "saved" && (
                  <span className="mm-order-status is-saved" data-testid="order-status-saved"> · Saved</span>
                )}
                {!dndEnabled && selectedCategory && !readOnlyMenu && (searchQuery || activeFilter !== "all") && (
                  <span className="mm-order-status"> · Clear filters to drag cards</span>
                )}
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

        <div className={`mm-content ${commandDockVisible ? "has-command-dock" : ""}`}>
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
                  <div className="mm-board-shell" ref={boardScrollRef}>
                  <MenuLassoLayer
                    enabled={dndEnabled && typeof window !== "undefined"}
                    containerRef={boardScrollRef}
                    onSelectIds={(ids, { additive }) => {
                      if (!ids.length) {
                        if (!additive) selectionApi.clear();
                        return;
                      }
                      selectionApi.setSelection((prev) => {
                        const nextIds = additive
                          ? [...new Set([...(prev.selectedIds || []), ...ids])]
                          : ids;
                        return {
                          selectedIds: nextIds,
                          anchorId: ids[0],
                          focusId: ids[ids.length - 1],
                        };
                      });
                    }}
                  />
                  <MenuManagerDndProvider
                    disabled={!dndEnabled}
                    fluid={fluidDnd}
                    sectionIds={filteredSections.map((section) => section.id)}
                    onDragStart={handleBoardDragStart}
                    onDragOver={handleBoardDragOver}
                    onDragEnd={handleBoardDragEnd}
                    onDragCancel={handleBoardDragCancel}
                    activeDragLabel={activeDragLabel}
                    activeDragCount={activeDragCount}
                  >
                  {filteredSections.map((section, sectionIdx) => {
                    const rawSection = menuData.find((s) => s.id === section.id);
                    const isSectionEmpty = (rawSection?.items || []).length === 0;
                    const sectionItemIds = (section.items || []).map((item) => item.id);
                    return (
                    <SectionFrame
                      key={section.id}
                      sectionId={section.id}
                      dndEnabled={dndEnabled}
                      label={section.name_en || "Section"}
                      header={(
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

                        <div
                          className="mm-section-actions"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={isolateInteractivePointer}
                        >
                          <button
                            className="mm-section-action-btn mm-reorder-fallback"
                            onClick={() => handleReorderSection(section.id, -1)}
                            disabled={sectionIdx === 0}
                            title="Move section up"
                            aria-label={`Move ${section.name_en || "section"} up`}
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            className="mm-section-action-btn mm-reorder-fallback"
                            onClick={() => handleReorderSection(section.id, 1)}
                            disabled={sectionIdx === filteredSections.length - 1}
                            title="Move section down"
                            aria-label={`Move ${section.name_en || "section"} down`}
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
                      )}
                    >
                      <AnimatePresence>
                        {expandedSections[section.id] && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25 }}
                          >
                            <SortableItemGrid
                              sectionId={section.id}
                              itemIds={sectionItemIds}
                              dndEnabled={dndEnabled}
                            >
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
                                <ItemFrame
                                  key={item.id}
                                  itemId={item.id}
                                  sectionId={section.id}
                                  dndEnabled={dndEnabled}
                                  selected={selectionApi.isSelected(item.id)}
                                  className={guestHidden ? "inactive" : ""}
                                  label={item.name_en || "Menu item"}
                                  onOpen={() => openEditItem(item)}
                                  onSelectClick={(event) => {
                                    event.stopPropagation();
                                    selectionApi.handleItemPointerSelect(event, item.id, filteredSections);
                                  }}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    selectionApi.ensureIncludes(item.id);
                                    setContextMenu({
                                      x: event.clientX,
                                      y: event.clientY,
                                      itemId: item.id,
                                    });
                                  }}
                                >
                                  <div className="mm-item-card-img-wrap">
                                    {item.image ? (
                                      <img
                                        src={item.image}
                                        alt={item.name_en}
                                        className="mm-item-card-img"
                                        loading="lazy"
                                        draggable={false}
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
                                    {(() => {
                                      const publishBadge = itemPublishBadge(item.id, publishIntel.diff);
                                      return publishBadge ? (
                                        <span
                                          className={`mm-badge mm-badge-publish mm-badge-publish-${publishBadge.key}`}
                                          data-testid={`publish-badge-${item.id}`}
                                        >
                                          {publishBadge.label}
                                        </span>
                                      ) : null;
                                    })()}
                                    <span className={`mm-badge mm-badge-visibility mm-badge-visibility-${visBadge.key}`}>
                                      {visBadge.label}
                                    </span>
                                    {item.sold_out && <span className="mm-badge mm-badge-sold-out">Sold Out</span>}
                                    {item.featured && (
                                      <span className="mm-badge mm-badge-featured">Highlighted</span>
                                    )}
                                    {item.new_item && !itemPublishBadge(item.id, publishIntel.diff) && (
                                      <span className="mm-badge mm-badge-new">New</span>
                                    )}
                                    {item.vegetarian && <span className="mm-badge mm-badge-veg">Veg</span>}
                                    {item.vegan && <span className="mm-badge mm-badge-vegan">Vegan</span>}
                                    {linkedBadge && (
                                      <span className="mm-badge mm-badge-linked" title={linkedBadge}>
                                        {linkedBadge}
                                      </span>
                                    )}
                                  </div>

                                  <div
                                    className="mm-item-card-actions"
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={isolateInteractivePointer}
                                  >
                                    <button
                                      className={`mm-item-action-btn ${item.sold_out ? "sold-out-active" : ""}`}
                                      onClick={() => handleToggleSoldOut(item)}
                                      title={item.sold_out ? "Mark available" : "Mark sold out"}
                                      aria-label={item.sold_out ? "Mark available on guest menu" : "Mark sold out on guest menu"}
                                    >
                                      <Ban size={14} />
                                    </button>
                                    <MenuManagerTooltip label={MENU_TOOLTIPS.visibility}>
                                      <button
                                        className={`mm-item-action-btn ${!guestHidden ? "active-toggle" : ""}`}
                                        onClick={() => openVisibilityModal(item)}
                                        title="Guest menu visibility"
                                        aria-label="Change guest menu visibility"
                                      >
                                        <Eye size={14} />
                                      </button>
                                    </MenuManagerTooltip>
                                    <button
                                      className="mm-item-action-btn"
                                      onClick={() => openEditItem(item)}
                                      title="Edit"
                                      aria-label={`Edit ${item.name_en || "item"}`}
                                    >
                                      <Edit3 size={14} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn"
                                      onClick={(e) => handleDuplicateItem(item, e)}
                                      title="Duplicate"
                                      aria-label={`Duplicate ${item.name_en || "item"}`}
                                    >
                                      <Copy size={14} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn mm-reorder-fallback"
                                      onClick={(e) => { e.stopPropagation(); handleReorderItem(section.id, item.id, -1); }}
                                      disabled={itemIdx === 0}
                                      title="Move up"
                                      aria-label={`Move ${item.name_en || "item"} up`}
                                    >
                                      <ChevronUp size={12} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn mm-reorder-fallback"
                                      onClick={(e) => { e.stopPropagation(); handleReorderItem(section.id, item.id, 1); }}
                                      disabled={itemIdx === section.items.length - 1}
                                      title="Move down"
                                      aria-label={`Move ${item.name_en || "item"} down`}
                                    >
                                      <ChevronDown size={12} />
                                    </button>
                                    <button
                                      className="mm-item-action-btn danger"
                                      onClick={(e) => handleDeleteItem(item, e)}
                                      title="Delete"
                                      aria-label={`Delete ${item.name_en || "item"}`}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </ItemFrame>
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
                                  onPointerDown={isolateInteractivePointer}
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
                            </SortableItemGrid>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </SectionFrame>
                    );
                  })}
                  </MenuManagerDndProvider>
                  </div>


                  <AnimatePresence>
                    {sectionCreateOpen && (
                      <motion.div
                        className="mm-section-create-form"
                        data-testid="section-create-form"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <p className="mm-section-create-title">New section</p>
                        <div className="mm-section-create-fields">
                          <input
                            className="mm-field-input"
                            placeholder="Name (English)"
                            value={sectionCreateData.name_en}
                            onChange={(e) =>
                              setSectionCreateData((prev) => ({ ...prev, name_en: e.target.value }))
                            }
                            aria-label="New section name in English"
                            autoFocus
                          />
                          <input
                            className="mm-field-input"
                            placeholder="الاسم (AR)"
                            dir="rtl"
                            value={sectionCreateData.name_ar}
                            onChange={(e) =>
                              setSectionCreateData((prev) => ({ ...prev, name_ar: e.target.value }))
                            }
                            aria-label="New section name in Arabic"
                          />
                        </div>
                        <div className="mm-section-create-actions">
                          <button
                            type="button"
                            className="mm-btn mm-btn-secondary"
                            onClick={() => {
                              setSectionCreateOpen(false);
                              setSectionCreateData({ name_en: "", name_ar: "" });
                            }}
                            disabled={sectionCreateSaving}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="mm-btn mm-btn-primary"
                            onClick={handleCreateSection}
                            disabled={sectionCreateSaving || !sectionCreateData.name_en.trim()}
                            data-testid="section-create-submit"
                          >
                            {sectionCreateSaving ? (
                              <Loader2 size={14} className="mm-spin-icon" />
                            ) : (
                              <Check size={14} />
                            )}
                            Create section
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button
                    type="button"
                    className="mm-add-section-btn"
                    onClick={handleAddSection}
                    disabled={readOnlyMenu || sectionCreateOpen}
                    data-testid="add-section-button"
                  >
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

      <MenuPublishPreviewPanel
        open={previewOpen}
        mode={previewMode}
        onModeChange={setPreviewMode}
        livePublication={publishIntel.livePublication}
        draftSnapshot={publishIntel.draftSnapshot}
        branchId={menuBranch}
        categories={categories}
        onClose={() => setPreviewOpen(false)}
        onLocateItem={locatePreviewItem}
      />
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
                    This dish is linked — changes here update every section where it appears.
                  </p>
                )}

                {/* Toggles */}
                <div className="mm-field">
                  <label className="mm-field-label">Options</label>
                  <div className="mm-toggles-grid">
                    <div className="mm-toggle-row">
                      <MenuManagerTooltip label={MENU_TOOLTIPS.soldOut}>
                        <span className="mm-toggle-label">Sold Out</span>
                      </MenuManagerTooltip>
                      <ToggleSwitch
                        value={editingItem.sold_out}
                        onChange={(v) => setEditingItem((p) => ({ ...p, sold_out: v }))}
                        ariaLabel="Mark item sold out on guest menu"
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
                <p className="mm-editor-save-note" data-testid="editor-save-note">
                  Saving updates the guest menu for this branch.
                </p>
                <div className="mm-editor-footer-actions">
                <button className="mm-btn mm-btn-secondary" onClick={closeEditor}>
                  Cancel
                </button>
                <button
                  className={`mm-btn mm-btn-primary${editorDirty ? " mm-btn-emphasis" : ""}`}
                  onClick={handleSaveItem}
                  disabled={saving}
                  aria-label={editorMode === "create" ? "Add item to guest menu" : "Save item to guest menu"}
                  data-testid="save-menu-item-button"
                >
                  {saving ? (
                    <Loader2 size={15} style={{ animation: "mm-spin 0.7s linear infinite" }} />
                  ) : (
                    <Check size={15} />
                  )}
                  {saving ? "Saving…" : editorMode === "create" ? "Add to guest menu" : "Save to guest menu"}
                </button>
                </div>
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

      <MenuCommandDock
        count={selectionApi.count}
        visible={commandDockVisible}
        visibilityMode={selectionAggregates.visibilityMode}
        visibilityLabel={selectionAggregates.visibilityLabel}
        soldOutMode={selectionAggregates.soldOutMode}
        soldOutLabel={selectionAggregates.soldOutLabel}
        readOnly={readOnlyMenu}
        onClear={selectionApi.clear}
        onMove={() => setMoveSheetOpen(true)}
        onVisibilityAction={runPrimaryVisibilityAction}
        onHide={hideSelected}
        onShow={showSelected}
        onSoldOutAction={runPrimarySoldOutAction}
        onSoldOut={markSelectedSoldOut}
        onMarkAvailable={markSelectedAvailable}
        moreItems={commandDockMoreItems}
      />

      <MenuContextMenu
        open={Boolean(contextMenu)}
        x={contextMenu?.x || 0}
        y={contextMenu?.y || 0}
        onClose={() => setContextMenu(null)}
        items={[
          {
            id: "edit",
            label: "Edit",
            disabled: readOnlyMenu || selectionApi.count !== 1,
            onSelect: () => {
              const loc = findItemLocation(menuData, contextMenu?.itemId);
              if (loc?.item) openEditItem(loc.item);
            },
          },
          {
            id: "quicklook",
            label: "Quick Look",
            shortcut: "Space",
            onSelect: () => openQuickLook(contextMenu?.itemId),
          },
          { id: "sep1", type: "separator" },
          {
            id: "move",
            label: "Move to…",
            disabled: readOnlyMenu || selectionApi.count < 1,
            onSelect: () => setMoveSheetOpen(true),
          },
          {
            id: "hide",
            label: "Hide",
            disabled: readOnlyMenu,
            onSelect: hideSelected,
          },
          {
            id: "show",
            label: "Show",
            disabled: readOnlyMenu,
            onSelect: showSelected,
          },
          {
            id: "soldout",
            label: "Mark Sold Out",
            disabled: readOnlyMenu,
            onSelect: markSelectedSoldOut,
          },
          {
            id: "available",
            label: "Mark Available",
            disabled: readOnlyMenu,
            onSelect: markSelectedAvailable,
          },
          { id: "sep2", type: "separator" },
          {
            id: "select-section",
            label: "Select Similar → Same section",
            onSelect: () => selectSimilarSection(contextMenu?.itemId),
          },
          {
            id: "shortcuts",
            label: "Keyboard Shortcuts",
            onSelect: () => setShortcutsOpen(true),
          }]}
      />

      <MenuMoveToSheet
        open={moveSheetOpen}
        sections={menuData}
        onClose={() => setMoveSheetOpen(false)}
        onChoose={(section) => moveSelectionToSection(section.id)}
      />

      <MenuCommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onRun={(cmd) => cmd.run?.()}
      />

      <MenuQuickLook
        item={
          quickLookItemId
            ? findItemLocation(menuData, quickLookItemId)?.item || null
            : null
        }
        sectionName={
          quickLookItemId
            ? menuData.find(
                (s) => s.id === findItemLocation(menuData, quickLookItemId)?.sectionId,
              )?.name_en
            : ""
        }
        categoryName={selectedCategory?.name_en || ""}
        allergenLabels={[]}
        onClose={() => setQuickLookItemId(null)}
      />

      {shortcutsOpen && (
        <div className="mm-sheet-backdrop" onClick={() => setShortcutsOpen(false)} data-testid="shortcuts-sheet">
          <div className="mm-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mm-sheet-header">
              <h3>Keyboard Shortcuts</h3>
              <button type="button" className="mm-btn mm-btn-secondary" onClick={() => setShortcutsOpen(false)}>Close</button>
            </div>
            <ul className="mm-shortcuts-list">
              <li><kbd>⌘/Ctrl</kbd> + click — Multi-select</li>
              <li><kbd>Shift</kbd> + click — Range select</li>
              <li><kbd>⌘/Ctrl</kbd> + <kbd>A</kbd> — Select all visible</li>
              <li><kbd>Esc</kbd> — Clear / close</li>
              <li><kbd>Space</kbd> — Quick Look</li>
              <li><kbd>⌘/Ctrl</kbd> + <kbd>K</kbd> — Command palette</li>
              <li><kbd>⌘/Ctrl</kbd> + <kbd>B</kbd> — Toggle navigation sidebar</li>
              <li><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> — Toggle menu sidebar</li>
              <li><kbd>⌘/Ctrl</kbd> + <kbd>Z</kbd> — Undo</li>
              <li><kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> — Redo</li>
              <li><kbd>Enter</kbd> — Edit focused item</li>
              <li>Double-click — Edit item</li>
            </ul>
          </div>
        </div>
      )}

      <MenuPublishDiffSheet
        open={publishDiffOpen}
        diff={publishIntel.diff}
        liveVersion={publishIntel.livePublication?.version ?? null}
        publishing={publishInFlight}
        readOnly={readOnlyMenu}
        onClose={() => setPublishDiffOpen(false)}
        onConfirmPublish={confirmPublishFromDiff}
      />

      <MenuVersionHistorySheet
        open={versionHistoryOpen}
        history={publishIntel.history}
        livePublication={publishIntel.livePublication}
        onClose={() => setVersionHistoryOpen(false)}
      />

    </div>
  );
}