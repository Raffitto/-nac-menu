import React from "react";
import { Ban, Eye, EyeOff, FolderInput, MoreHorizontal, X } from "lucide-react";

export default function MenuSelectionToolbar({
  count = 0,
  arrangeMode = false,
  onClear,
  onMove,
  onHide,
  onShow,
  onSoldOut,
  onMore,
  onDoneArrange,
}) {
  if (count < 2 && !arrangeMode) return null;

  return (
    <div className="mm-selection-toolbar" data-testid="menu-selection-toolbar" role="toolbar" aria-label="Selection actions">
      <span className="mm-selection-toolbar-count">
        {count} selected
      </span>
      <div className="mm-selection-toolbar-actions">
        <button type="button" className="mm-btn mm-btn-secondary mm-selection-btn" onClick={onMove} disabled={count < 1}>
          <FolderInput size={14} />
          Move
        </button>
        <button type="button" className="mm-btn mm-btn-secondary mm-selection-btn" onClick={onHide} disabled={count < 1}>
          <EyeOff size={14} />
          Hide
        </button>
        <button type="button" className="mm-btn mm-btn-secondary mm-selection-btn" onClick={onShow} disabled={count < 1}>
          <Eye size={14} />
          Show
        </button>
        <button type="button" className="mm-btn mm-btn-secondary mm-selection-btn" onClick={onSoldOut} disabled={count < 1}>
          <Ban size={14} />
          Sold Out
        </button>
        <button type="button" className="mm-btn mm-btn-secondary mm-selection-btn" onClick={onMore} aria-label="More selection actions">
          <MoreHorizontal size={14} />
          More
        </button>
        {arrangeMode ? (
          <button type="button" className="mm-btn mm-btn-primary mm-selection-btn" onClick={onDoneArrange} data-testid="arrange-done">
            Done
          </button>
        ) : (
          <button type="button" className="mm-selection-clear" onClick={onClear} aria-label="Clear selection">
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
