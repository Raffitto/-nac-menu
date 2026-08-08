import React from "react";
import { X } from "lucide-react";
import { getItemVisibilityBadge } from "../../lib/menuVisibility";

export default function MenuQuickLook({
  item,
  sectionName = "",
  categoryName = "",
  allergenLabels = [],
  onClose,
}) {
  if (!item) return null;
  const vis = getItemVisibilityBadge(item);

  return (
    <div className="mm-quicklook-backdrop" data-testid="menu-quicklook" onClick={onClose}>
      <div
        className="mm-quicklook-panel"
        role="dialog"
        aria-label={`Quick Look ${item.name_en || "item"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mm-quicklook-close" onClick={onClose} aria-label="Close Quick Look">
          <X size={16} />
        </button>
        <div className="mm-quicklook-media">
          {item.image ? (
            <img src={item.image} alt={item.name_en || ""} />
          ) : (
            <div className="mm-quicklook-no-image">No image</div>
          )}
        </div>
        <div className="mm-quicklook-body">
          <h3>{item.name_en || "Untitled"}</h3>
          {item.name_ar ? <p className="mm-quicklook-ar" dir="rtl">{item.name_ar}</p> : null}
          {(item.desc_en || item.desc_ar) && (
            <p className="mm-quicklook-desc">{item.desc_en || item.desc_ar}</p>
          )}
          <dl className="mm-quicklook-meta">
            <div><dt>Price</dt><dd>{item.price || "—"}</dd></div>
            <div><dt>Calories</dt><dd>{item.calories || "—"}</dd></div>
            <div><dt>Context</dt><dd>{[categoryName, sectionName].filter(Boolean).join(" → ") || "—"}</dd></div>
            <div><dt>Visibility</dt><dd>{vis.label}</dd></div>
            <div><dt>Sold out</dt><dd>{item.sold_out ? "Yes" : "No"}</dd></div>
            <div><dt>Allergens</dt><dd>{allergenLabels.length ? allergenLabels.join(", ") : "None listed"}</dd></div>
          </dl>
          <p className="mm-quicklook-hint">Space or Escape to close · inspection only</p>
        </div>
      </div>
    </div>
  );
}
