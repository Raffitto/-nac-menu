import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Desktop rubber-band selection over empty board space.
 * Disabled on touch / while arrange-insensitive hosts.
 */
export default function MenuLassoLayer({
  enabled = true,
  containerRef,
  onSelectIds,
  additive = false,
}) {
  const [rect, setRect] = useState(null);
  const startRef = useRef(null);

  const onPointerDown = useCallback(
    (event) => {
      if (!enabled) return;
      if (event.button !== 0) return;
      if (event.pointerType === "touch") return;
      const target = event.target;
      if (
        target.closest?.(
          ".mm-item-card, .mm-section-header, .mm-section-drag-handle, button, input, textarea, a, .mm-context-menu, .mm-command-dock, .mm-command-dock-slot, .mm-palette, .mm-quicklook-panel",
        )
      ) {
        return;
      }
      const host = containerRef?.current;
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      const x = event.clientX - bounds.left + host.scrollLeft;
      const y = event.clientY - bounds.top + host.scrollTop;
      startRef.current = { x, y, additive: additive || event.shiftKey };
      setRect({ x, y, w: 0, h: 0 });
      host.setPointerCapture?.(event.pointerId);
    },
    [additive, containerRef, enabled],
  );

  const onPointerMove = useCallback(
    (event) => {
      if (!startRef.current) return;
      const host = containerRef?.current;
      if (!host) return;
      const bounds = host.getBoundingClientRect();
      const x = event.clientX - bounds.left + host.scrollLeft;
      const y = event.clientY - bounds.top + host.scrollTop;
      const sx = startRef.current.x;
      const sy = startRef.current.y;
      setRect({
        x: Math.min(sx, x),
        y: Math.min(sy, y),
        w: Math.abs(x - sx),
        h: Math.abs(y - sy),
      });
    },
    [containerRef],
  );

  const onPointerUp = useCallback(
    (event) => {
      if (!startRef.current || !rect) {
        startRef.current = null;
        setRect(null);
        return;
      }
      const host = containerRef?.current;
      if (!host) return;
      const hostBounds = host.getBoundingClientRect();
      const left = rect.x;
      const top = rect.y;
      const right = rect.x + rect.w;
      const bottom = rect.y + rect.h;
      const hitIds = [];
      host.querySelectorAll("[data-testid^='sortable-item-']").forEach((node) => {
        const r = node.getBoundingClientRect();
        const nx1 = r.left - hostBounds.left + host.scrollLeft;
        const ny1 = r.top - hostBounds.top + host.scrollTop;
        const nx2 = nx1 + r.width;
        const ny2 = ny1 + r.height;
        const intersects = !(nx2 < left || nx1 > right || ny2 < top || ny1 > bottom);
        if (intersects) {
          const id = node.getAttribute("data-testid")?.replace("sortable-item-", "");
          if (id) hitIds.push(id);
        }
      });
      onSelectIds?.(hitIds, { additive: startRef.current.additive });
      startRef.current = null;
      setRect(null);
      try {
        host.releasePointerCapture?.(event.pointerId);
      } catch (_) {
        /* ignore */
      }
    },
    [containerRef, onSelectIds, rect],
  );

  // Attach listeners to the board container without covering cards.
  useEffect(() => {
    const host = containerRef?.current;
    if (!enabled || !host) return undefined;
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
    };
  }, [containerRef, enabled, onPointerDown, onPointerMove, onPointerUp]);

  if (!enabled || !rect || rect.w + rect.h <= 4) return null;

  return (
    <div className="mm-lasso-layer" data-testid="menu-lasso-layer" aria-hidden="true">
      <div
        className="mm-lasso-rect"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      />
    </div>
  );
}
