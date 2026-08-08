import React from "react";

export default function MenuMoveToSheet({
  open,
  sections = [],
  title = "Move to section",
  onClose,
  onChoose,
}) {
  if (!open) return null;
  return (
    <div className="mm-sheet-backdrop" data-testid="menu-move-to-sheet" onClick={onClose}>
      <div className="mm-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="mm-sheet-header">
          <h3>{title}</h3>
          <button type="button" className="mm-btn mm-btn-secondary" onClick={onClose}>Close</button>
        </div>
        <div className="mm-sheet-list">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className="mm-sheet-item"
              onClick={() => onChoose?.(section)}
            >
              {section.name_en || "Section"}
              <span>{(section.items || []).length} items</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
