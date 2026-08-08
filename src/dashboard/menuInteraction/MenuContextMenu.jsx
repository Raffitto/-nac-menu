import React, { useEffect, useRef } from "react";

export default function MenuContextMenu({
  open,
  x = 0,
  y = 0,
  items = [],
  onClose,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    const onDown = (event) => {
      if (!ref.current?.contains(event.target)) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="mm-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      data-testid="menu-context-menu"
    >
      {items.map((item) => {
        if (item.type === "separator") {
          return <div key={item.id || item.label} className="mm-context-sep" />;
        }
        return (
          <button
            key={item.id || item.label}
            type="button"
            role="menuitem"
            className={`mm-context-item ${item.danger ? "is-danger" : ""}`}
            disabled={item.disabled}
            title={item.disabledReason || undefined}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose?.();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
          </button>
        );
      })}
    </div>
  );
}
