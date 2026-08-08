import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Monitor, Smartphone, Tablet, X } from "lucide-react";
import { snapshotToGuestMenu } from "../../lib/menuPublishSnapshots";
import { getFullMenu } from "../../lib/menuApi";

const ContextualMenuView = lazy(() => import("../../components/ContextualMenuView"));

const DEVICE_PRESETS = [
  { id: "phone", label: "Phone", width: 390, icon: Smartphone },
  { id: "tablet", label: "Tablet", width: 768, icon: Tablet },
  { id: "desktop", label: "Desktop", width: 1100, icon: Monitor },
];

/**
 * Manager-only Live vs Draft preview.
 * LIVE = last verified publication snapshot
 * DRAFT = current branch tables (via getFullMenu / draft snapshot)
 * Read-only — never publishes or mutates.
 */
export default function MenuPublishPreviewPanel({
  open,
  mode = "draft",
  onModeChange,
  livePublication = null,
  draftSnapshot = null,
  branchId,
  categories = [],
  onClose,
  onLocateItem,
}) {
  const [device, setDevice] = useState("phone");
  const [activeCategory, setActiveCategory] = useState("");
  const [activeMenuTab, setActiveMenuTab] = useState("");
  const [activeSection, setActiveSection] = useState("");
  const [liveGuest, setLiveGuest] = useState(null);
  const [draftGuest, setDraftGuest] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const liveMenu = livePublication?.snapshot
          ? snapshotToGuestMenu(livePublication.snapshot)
          : null;
        let draftMenu = null;
        if (draftSnapshot) {
          draftMenu = snapshotToGuestMenu(draftSnapshot);
        } else if (branchId) {
          const { data } = await getFullMenu({ branchId, bypassCache: true });
          draftMenu = data;
        }
        if (!cancelled) {
          setLiveGuest(liveMenu);
          setDraftGuest(draftMenu);
          const cats = (mode === "live" ? liveMenu : draftMenu)?.categories || [];
          if (cats[0]?.id) setActiveCategory((prev) => prev || cats[0].id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, livePublication, draftSnapshot, branchId, mode]);

  const guest = mode === "live" ? liveGuest : draftGuest;
  const menuData = guest?.menuData || {};

  const devicePreset = DEVICE_PRESETS.find((d) => d.id === device) || DEVICE_PRESETS[0];

  const categoryOptions = useMemo(() => {
    const previewCategories = guest?.categories || [];
    if (previewCategories.length) return previewCategories;
    return (categories || []).map((c) => ({
      id: c.slug || c.id,
      en: c.name_en || c.id,
      ar: c.name_ar || "",
    }));
  }, [guest, categories]);

  if (!open) return null;

  return (
    <aside className="mm-publish-preview" data-testid="menu-publish-preview" aria-label="Menu preview">
      <div className="mm-publish-preview-header">
        <div className="mm-publish-preview-modes" role="tablist" aria-label="Preview source">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "live"}
            className={mode === "live" ? "is-active" : ""}
            onClick={() => onModeChange?.("live")}
            data-testid="preview-mode-live"
          >
            Live
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "draft"}
            className={mode === "draft" ? "is-active" : ""}
            onClick={() => onModeChange?.("draft")}
            data-testid="preview-mode-draft"
          >
            Draft
          </button>
        </div>
        <button type="button" className="mm-btn mm-btn-secondary" onClick={onClose} aria-label="Close preview">
          <X size={14} />
        </button>
      </div>

      <p className="mm-publish-preview-caption">
        {mode === "live"
          ? livePublication
            ? `Last published version ${livePublication.version}`
            : "No verified publication yet"
          : "Current saved menu (draft / guest tables)"}
      </p>

      <div className="mm-publish-preview-toolbar">
        <label>
          Context
          <select
            value={activeCategory}
            onChange={(e) => {
              setActiveCategory(e.target.value);
              setActiveMenuTab("");
              setActiveSection("");
            }}
            aria-label="Preview menu context"
          >
            {categoryOptions.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.en || cat.id}
              </option>
            ))}
          </select>
        </label>
        <div className="mm-publish-preview-devices" role="group" aria-label="Preview device">
          {DEVICE_PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                className={device === preset.id ? "is-active" : ""}
                onClick={() => setDevice(preset.id)}
                aria-label={preset.label}
                title={preset.label}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mm-publish-preview-frame-wrap">
        <div
          className="mm-publish-preview-frame"
          style={{ width: Math.min(devicePreset.width, 1100) }}
          data-testid="preview-device-frame"
        >
          {loading ? (
            <div className="mm-loading">Loading preview…</div>
          ) : (
            <Suspense fallback={<div className="mm-loading">Loading guest view…</div>}>
              <ContextualMenuView
                categoryIds={[activeCategory].filter(Boolean)}
                isManualMode
                categories={categoryOptions}
                menuData={menuData}
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                isArabic={false}
                lang="en"
                search=""
                isAllowed={() => true}
                onOpenItem={(item) => {
                  if (item?.id) onLocateItem?.(item.id);
                }}
                onBackToContextual={() => {}}
                activeSection={activeSection}
                onSectionNavigate={() => {}}
                activeMenuTab={activeMenuTab}
                setActiveMenuTab={setActiveMenuTab}
                setActiveSection={setActiveSection}
                onMenuTabOpen={() => {}}
                loading={loading}
              />
            </Suspense>
          )}
        </div>
      </div>
    </aside>
  );
}
