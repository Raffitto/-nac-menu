import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Ban,
  Eye,
  EyeOff,
  FolderInput,
  MoreHorizontal,
  X,
} from "lucide-react";

/**
 * Floating contextual multi-selection command dock.
 * Hidden at 0 desktop selection; 2+ on desktop; 1+ on coarse/touch when helpful.
 */
export default function MenuCommandDock({
  count = 0,
  visible = false,
  visibilityMode = "visible",
  visibilityLabel = "Hide",
  soldOutMode = "available",
  soldOutLabel = "Sold Out",
  readOnly = false,
  onClear,
  onMove,
  onVisibilityAction,
  onHide,
  onShow,
  onSoldOutAction,
  onSoldOut,
  onMarkAvailable,
  moreItems = [],
}) {
  const moreId = useId();
  const rootRef = useRef(null);
  const moreBtnRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setMoreOpen(false);
      setVisibilityMenuOpen(false);
      setStatusMenuOpen(false);
    }
  }, [visible]);

  useEffect(() => {
    if (!moreOpen && !visibilityMenuOpen && !statusMenuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        setVisibilityMenuOpen(false);
        setStatusMenuOpen(false);
      }
    };
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setMoreOpen(false);
        setVisibilityMenuOpen(false);
        setStatusMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [moreOpen, visibilityMenuOpen, statusMenuOpen]);

  const filteredMore = useMemo(
    () => (moreItems || []).filter(Boolean),
    [moreItems],
  );

  if (!visible) return null;

  const runVisibility = () => {
    if (visibilityMode === "mixed") {
      setVisibilityMenuOpen((v) => !v);
      setStatusMenuOpen(false);
      setMoreOpen(false);
      return;
    }
    onVisibilityAction?.();
  };

  const runSoldOut = () => {
    if (soldOutMode === "mixed") {
      setStatusMenuOpen((v) => !v);
      setVisibilityMenuOpen(false);
      setMoreOpen(false);
      return;
    }
    onSoldOutAction?.();
  };

  return (
    <div className="mm-command-dock-slot" data-testid="menu-command-dock-slot">
      <div
        ref={rootRef}
        className="mm-command-dock"
        data-testid="menu-command-dock"
        role="toolbar"
        aria-label="Selection commands"
      >
        <span className="mm-command-dock-count" aria-live="polite">
          {count} selected
        </span>

        <span className="mm-command-dock-sep" aria-hidden="true" />

        <div className="mm-command-dock-group mm-command-dock-group--primary">
          <button
            type="button"
            className="mm-command-dock-btn mm-command-dock-btn--primary"
            onClick={onMove}
            disabled={readOnly || count < 1}
            data-testid="command-dock-move"
          >
            <FolderInput size={14} aria-hidden="true" />
            Move
          </button>
        </div>

        <span className="mm-command-dock-sep" aria-hidden="true" />

        <div className="mm-command-dock-group">
          <div className="mm-command-dock-menu-wrap">
            <button
              type="button"
              className="mm-command-dock-btn"
              onClick={runVisibility}
              disabled={readOnly || count < 1}
              data-testid="command-dock-visibility"
              aria-haspopup={visibilityMode === "mixed" ? "menu" : undefined}
              aria-expanded={visibilityMode === "mixed" ? visibilityMenuOpen : undefined}
            >
              {visibilityMode === "hidden" ? (
                <Eye size={14} aria-hidden="true" />
              ) : (
                <EyeOff size={14} aria-hidden="true" />
              )}
              {visibilityLabel}
            </button>
            {visibilityMenuOpen ? (
              <div className="mm-command-dock-menu" role="menu" data-testid="command-dock-visibility-menu">
                <button
                  type="button"
                  role="menuitem"
                  className="mm-command-dock-menu-item"
                  onClick={() => {
                    setVisibilityMenuOpen(false);
                    onHide?.();
                  }}
                >
                  Hide
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="mm-command-dock-menu-item"
                  onClick={() => {
                    setVisibilityMenuOpen(false);
                    onShow?.();
                  }}
                >
                  Show
                </button>
              </div>
            ) : null}
          </div>

          <div className="mm-command-dock-menu-wrap">
            <button
              type="button"
              className="mm-command-dock-btn"
              onClick={runSoldOut}
              disabled={readOnly || count < 1}
              data-testid="command-dock-soldout"
              aria-haspopup={soldOutMode === "mixed" ? "menu" : undefined}
              aria-expanded={soldOutMode === "mixed" ? statusMenuOpen : undefined}
            >
              <Ban size={14} aria-hidden="true" />
              {soldOutLabel}
            </button>
            {statusMenuOpen ? (
              <div className="mm-command-dock-menu" role="menu" data-testid="command-dock-status-menu">
                <button
                  type="button"
                  role="menuitem"
                  className="mm-command-dock-menu-item"
                  onClick={() => {
                    setStatusMenuOpen(false);
                    onSoldOut?.();
                  }}
                >
                  Sold Out
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="mm-command-dock-menu-item"
                  onClick={() => {
                    setStatusMenuOpen(false);
                    onMarkAvailable?.();
                  }}
                >
                  Available
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <span className="mm-command-dock-sep" aria-hidden="true" />

        <div className="mm-command-dock-group mm-command-dock-group--trailing">
          <div className="mm-command-dock-menu-wrap">
            <button
              ref={moreBtnRef}
              type="button"
              className="mm-command-dock-btn mm-command-dock-btn--ghost"
              onClick={() => {
                setMoreOpen((v) => !v);
                setVisibilityMenuOpen(false);
                setStatusMenuOpen(false);
              }}
              aria-label="More selection actions"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-controls={moreId}
              data-testid="command-dock-more"
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {moreOpen ? (
              <div
                id={moreId}
                className="mm-command-dock-menu mm-command-dock-menu--right"
                role="menu"
                data-testid="command-dock-more-menu"
              >
                {filteredMore.map((item, index) => {
                  if (item.type === "separator") {
                    return <div key={item.id || `sep-${index}`} className="mm-command-dock-menu-sep" />;
                  }
                  return (
                    <button
                      key={item.id || item.label}
                      type="button"
                      role="menuitem"
                      className={`mm-command-dock-menu-item ${item.danger ? "is-danger" : ""}`}
                      disabled={item.disabled}
                      onClick={() => {
                        if (item.disabled) return;
                        setMoreOpen(false);
                        item.onSelect?.();
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="mm-command-dock-clear"
            onClick={onClear}
            aria-label="Clear selection"
            data-testid="command-dock-clear"
            title="Clear selection"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
